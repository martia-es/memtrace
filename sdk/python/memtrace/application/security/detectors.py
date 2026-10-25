"""Deterministic detectors backed by existing libraries (see ADR-103 and spikes/redteam).

None of them calls the network or an LLM. The libraries are imported lazily, so importing
`memtrace.security` costs nothing until a detector runs; they come with the `security` extra.
"""
import re
import secrets
from typing import Callable, List, Optional

from memtrace.domain.security import Verdict

MAX_TEXT = 10_000  # bound the work an adversarial input can cause

# Only prefix/format plugins: detect-secrets' default entropy plugins flag plain English.
_SECRET_PLUGINS = (
    "AWSKeyDetector",
    "GitHubTokenDetector",
    "JwtTokenDetector",
    "PrivateKeyDetector",
    "SlackDetector",
    "StripeDetector",
    "BasicAuthDetector",
)


def _missing(extra: str, exc: ImportError) -> ImportError:
    return ImportError(f"This detector requires: pip install 'memtrace-ai[{extra}]'")


def secret_leak(text: str) -> Verdict:
    """API keys, tokens and private keys in `text` (detect-secrets, format plugins only)."""
    try:
        from detect_secrets.core.scan import scan_line
        from detect_secrets.settings import transient_settings
    except ImportError as exc:
        raise _missing("security", exc) from exc
    found = False
    with transient_settings({"plugins_used": [{"name": p} for p in _SECRET_PLUGINS]}):
        for line in str(text)[:MAX_TEXT].splitlines():
            if any(True for _ in scan_line(line)):
                found = True
                break
    return Verdict("secret_leak", found, "secret_leak" if found else None, "error" if found else "info")


_pii_recognizers: Optional[List] = None


def _pii():
    global _pii_recognizers
    if _pii_recognizers is None:
        try:
            from presidio_analyzer.predefined_recognizers import (
                CreditCardRecognizer,
                EmailRecognizer,
                EsNifRecognizer,
                IbanRecognizer,
                UsSsnRecognizer,
            )
        except ImportError as exc:
            raise _missing("security", exc) from exc
        # Format + checksum recognizers only: they run without loading a spaCy model. Names are the opt-in layer of memtrace.pii.
        _pii_recognizers = [CreditCardRecognizer(), IbanRecognizer(), EmailRecognizer(), EsNifRecognizer(), UsSsnRecognizer()]
    return _pii_recognizers


def pii_leak(text: str) -> Verdict:
    """Card numbers (Luhn), IBANs, emails, Spanish NIF and US SSN in `text` (Presidio recognizers, no NLP)."""
    snippet = str(text)[:MAX_TEXT]
    hits = 0
    for recognizer in _pii():
        hits += len(recognizer.analyze(snippet, recognizer.supported_entities, None))
    return Verdict("pii_leak", hits > 0, "pii_leak" if hits else None, "warn" if hits else "info", score=float(hits) if hits else None)


def _normalize(text: str) -> List[str]:
    return re.sub(r"\W+", " ", str(text)[:MAX_TEXT].lower()).split()


def _ngrams(words: List[str], n: int) -> set:
    return {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}


def new_canary() -> str:
    """A random marker to place inside the system prompt: if it shows up in an output, the prompt leaked."""
    return f"mtc-{secrets.token_hex(6)}"


def system_prompt_leak(output: str, system_prompt: str, *, threshold: float = 0.3, canary: Optional[str] = None, n: int = 3) -> Verdict:
    """Share of the system prompt's word n-grams that appear in `output`, or its canary marker.

    Catches copies and light edits. A paraphrase or a translation is NOT caught (it scores like unrelated
    text): measure those with the red team run, not here.
    """
    if canary and canary in str(output):
        return Verdict("system_prompt_leak", True, "system_prompt_leak", "error", score=1.0)
    prompt_grams = _ngrams(_normalize(system_prompt), n)
    if not prompt_grams:
        return Verdict("system_prompt_leak", False)
    overlap = len(prompt_grams & _ngrams(_normalize(output), n)) / len(prompt_grams)
    detected = overlap >= threshold
    return Verdict("system_prompt_leak", detected, "system_prompt_leak" if detected else None, "warn" if detected else "info", score=round(overlap, 3))


DETECTORS: dict = {"secret_leak": secret_leak, "pii_leak": pii_leak}
Detector = Callable[..., Verdict]
