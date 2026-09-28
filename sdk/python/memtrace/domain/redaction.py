"""Redaction policy for anything that leaves the process (ADR-021). Pure: no OTel, no frameworks.

Two independent detectors, both applied to every span regardless of who created it:

* by **key**: a value whose key contains a sensitive fragment (`api_key`, `password`…) is masked;
* by **value**: secrets with a recognizable shape (`sk-…`, JWTs, `Bearer …`, private keys, `user:pass@`
  in URLs, `password=…` in free text) are masked wherever they appear, including inside prompts.

Personal data with no fixed shape (names, emails…) is out of scope by design; that is what the
user-provided `hook` is for.
"""
import json
import logging
import re
from typing import Any, Callable, Iterable, Optional, Tuple

from memtrace.domain.serialization import DEFAULT_SENSITIVE_KEYS, REDACTED, SERIALIZATION_FAILED

logger = logging.getLogger("memtrace")

_MAX_DEPTH = 64

# Attribute keys / prefixes that carry free-form content (the user hook only sees these and JSON blobs)
CONTENT_KEYS = frozenset(
    {
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "gen_ai.system_instructions",
        "gen_ai.tool.call.arguments",
        "gen_ai.tool.call.result",
        "memtrace.input",
        "memtrace.output",
        "memtrace.metadata",
        "content",
        "exception.message",
        "exception.stacktrace",
    }
)
CONTENT_PREFIXES = ("gen_ai.prompt", "gen_ai.completion", "pydantic_ai.", "traceloop.entity.")

_KEY_FRAGMENT = r"(?:api[_-]?key|password|passwd|secret|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|cookie)"

_TEXT_PATTERNS: Tuple[Tuple["re.Pattern[str]", str], ...] = (
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), REDACTED),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"), f"Bearer {REDACTED}"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), REDACTED),  # JWT
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), REDACTED),  # OpenAI / Anthropic
    (re.compile(r"\bmtk_[A-Za-z0-9]{10,}"), REDACTED),  # MemTrace API keys
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), REDACTED),  # AWS access key id
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), REDACTED),  # GitHub
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}"), REDACTED),  # Google API key
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), REDACTED),  # Slack
    (re.compile(r"(?<=://)[^/\s:@]+:[^/\s@]+(?=@)"), REDACTED),  # user:password@host
    # `password=hunter2`, `"api_key": "sk"`, `Authorization: xyz` in free text
    (re.compile(rf"(?i)(\b[\w-]*{_KEY_FRAGMENT}[\w-]*[\"']?\s*[:=]\s*[\"']?)([^\s\"',;&}}\]]+)"), rf"\1{REDACTED}"),
)


def _looks_like_json(text: str) -> bool:
    stripped = text.lstrip()
    return stripped[:1] in ("{", "[") and stripped.rstrip()[-1:] in ("}", "]")


class Redactor:
    """Masks secrets in span attributes. `hook` (optional) gets content values and returns what to keep."""

    def __init__(
        self,
        keys: Iterable[str] = DEFAULT_SENSITIVE_KEYS,
        hook: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        self._keys = tuple(keys)
        self._hook = hook

    def _is_sensitive_key(self, key: Any) -> bool:
        lowered = str(key).lower()
        return any(fragment in lowered for fragment in self._keys)

    def scrub_text(self, text: str) -> str:
        for pattern, replacement in _TEXT_PATTERNS:
            text = pattern.sub(replacement, text)
        return text

    def _redact_data(self, value: Any, depth: int = 0) -> Any:
        if isinstance(value, str):
            return self.scrub_text(value)
        if depth >= _MAX_DEPTH:
            return "…[max depth]"
        if isinstance(value, dict):
            return {
                k: REDACTED if self._is_sensitive_key(k) else self._redact_data(v, depth + 1) for k, v in value.items()
            }
        if isinstance(value, list):
            return [self._redact_data(v, depth + 1) for v in value]
        return value

    def _apply_hook(self, value: Any) -> Any:
        if self._hook is None:
            return value
        try:
            return self._hook(value)
        except Exception as exc:  # fail closed: a broken hook must never let raw content through
            logger.warning("[MemTrace] The redact hook raised (%s); content replaced.", exc)
            return SERIALIZATION_FAILED

    def _is_content_key(self, key: str) -> bool:
        return key in CONTENT_KEYS or key.startswith(CONTENT_PREFIXES)

    def string_attribute(self, key: str, value: str) -> str:
        """Redacted version of a string attribute (or event attribute)."""
        if self._is_sensitive_key(key):
            return REDACTED
        if _looks_like_json(value):
            try:
                data = self._apply_hook(self._redact_data(json.loads(value)))
                return json.dumps(data, default=str, ensure_ascii=False)
            except ValueError:
                pass  # truncated / invalid JSON: treat as text below
        text = self.scrub_text(value)
        if self._hook is not None and self._is_content_key(key):
            hooked = self._apply_hook(text)
            return hooked if isinstance(hooked, str) else json.dumps(hooked, default=str, ensure_ascii=False)
        return text

    def attribute(self, key: str, value: Any) -> Any:
        """Redacted version of any attribute value; non-text values pass through untouched."""
        if isinstance(value, str):
            return self.string_attribute(key, value)
        if isinstance(value, (list, tuple)) and value and all(isinstance(v, str) for v in value):
            redacted = [self.string_attribute(key, v) for v in value]
            return tuple(redacted) if isinstance(value, tuple) else redacted
        if self._is_sensitive_key(key) and value is not None and not isinstance(value, bool):
            return REDACTED
        return value
