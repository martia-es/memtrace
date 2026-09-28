"""JSON serialization of captured payloads: bounded, redacted and never raising."""
import json
import logging
from typing import Any, Iterable, Optional

logger = logging.getLogger("memtrace")

REDACTED = "[REDACTED]"
SERIALIZATION_FAILED = "[UNSERIALIZABLE]"

# Matched as case-insensitive substrings of mapping keys. "token" is deliberately absent: it
# would mask `input_tokens` / `max_tokens`.
DEFAULT_SENSITIVE_KEYS = (
    "api_key",
    "apikey",
    "api-key",
    "password",
    "passwd",
    "secret",
    "authorization",
    "access_token",
    "refresh_token",
    "private_key",
    "credential",
    "bearer",
    "cookie",
)

_MAX_DEPTH = 8
_MAX_ITEMS = 200


def truncate(text: str, limit: int) -> str:
    if limit > 0 and len(text) > limit:
        return text[:limit] + "…[truncated]"
    return text


def _chat_message(obj: Any) -> Optional[dict]:
    """Chat messages (LangChain, etc.: `type` + `content`) as {role, content[, tool_calls]}."""
    role, content = getattr(obj, "type", None), getattr(obj, "content", None)
    if not isinstance(role, str) or content is None:
        return None
    message: dict = {"role": role, "content": content}
    calls = getattr(obj, "tool_calls", None)
    if calls:
        message["tool_calls"] = calls
    return message


def _is_sensitive(key: Any, sensitive: Iterable[str]) -> bool:
    lowered = str(key).lower()
    return any(fragment in lowered for fragment in sensitive)


def _prune(value: Any, limit: int, sensitive: Iterable[str], depth: int = 0) -> Any:
    """Copy of `value` made only of JSON types, with strings/containers/depth bounded and
    sensitive keys masked. Bounding happens *before* serialization so a huge argument is never
    fully serialized just to be truncated afterwards."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return truncate(value, limit)
    if depth >= _MAX_DEPTH:
        return "…[max depth]"
    message = _chat_message(value)
    if message is not None:
        value = message
    if isinstance(value, dict):
        pruned = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= _MAX_ITEMS:
                pruned["…"] = f"[{len(value) - _MAX_ITEMS} more items]"
                break
            pruned[str(key)] = REDACTED if _is_sensitive(key, sensitive) else _prune(item, limit, sensitive, depth + 1)
        return pruned
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value) if len(value) <= _MAX_ITEMS else list(value)[:_MAX_ITEMS]
        pruned_list = [_prune(item, limit, sensitive, depth + 1) for item in items]
        if len(value) > _MAX_ITEMS:
            pruned_list.append(f"…[{len(value) - _MAX_ITEMS} more items]")
        return pruned_list
    return truncate(str(value), limit)


def to_json(
    value: Any,
    limit: int = 0,
    sensitive_keys: Iterable[str] = DEFAULT_SENSITIVE_KEYS,
) -> str:
    """JSON text of `value`, capped at `limit` characters (`0` = unlimited).

    Fails closed: if pruning raises, a placeholder is returned instead of the raw payload.
    """
    try:
        text = json.dumps(_prune(value, limit, tuple(sensitive_keys)), default=str, ensure_ascii=False)
    except Exception as exc:
        logger.warning("[MemTrace] Could not serialize captured content: %s", exc)
        return SERIALIZATION_FAILED
    return truncate(text, limit)
