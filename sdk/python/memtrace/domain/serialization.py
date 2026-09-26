import json
from typing import Any


def truncate(text: str, limit: int) -> str:
    if limit > 0 and len(text) > limit:
        return text[:limit] + "…[truncated]"
    return text


def _default(obj: Any) -> Any:
    """Mensajes de chat (LangChain, etc.: `type` + `content`) como {role, content}; el resto, `str`."""
    role, content = getattr(obj, "type", None), getattr(obj, "content", None)
    if isinstance(role, str) and content is not None:
        d: dict = {"role": role, "content": content}
        calls = getattr(obj, "tool_calls", None)
        if calls:
            d["tool_calls"] = calls
        return d
    return str(obj)


def to_json(value: Any, limit: int = 0) -> str:
    try:
        text = json.dumps(value, default=_default, ensure_ascii=False)
    except Exception:
        text = str(value)
    return truncate(text, limit)
