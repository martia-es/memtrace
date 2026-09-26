import json
from typing import Any


def truncate(text: str, limit: int) -> str:
    if limit > 0 and len(text) > limit:
        return text[:limit] + "…[truncated]"
    return text


def to_json(value: Any, limit: int = 0) -> str:
    try:
        text = json.dumps(value, default=str, ensure_ascii=False)
    except Exception:
        text = str(value)
    return truncate(text, limit)
