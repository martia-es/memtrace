"""OTel attribute type coercion, run when a span is created. Not a security boundary: secret
redaction is a separate, later concern owned entirely by `SanitizingSpanExporter` (ADR-021),
which runs at export time and covers spans from every source, not just this adapter.
"""
import json
from typing import Any, Dict, Mapping

_PRIMITIVES = (bool, str, int, float)


def sanitize_value(val: Any) -> Any:
    """Valid OTel attribute type: a primitive or a homogeneous sequence; anything else, JSON/str."""
    if isinstance(val, _PRIMITIVES):
        return val
    if isinstance(val, (list, tuple)) and val:
        first = type(val[0])
        if first in _PRIMITIVES and all(type(v) is first for v in val):
            return list(val)
    if isinstance(val, (dict, list, tuple, set, frozenset)):
        try:
            return json.dumps(val, default=str)
        except Exception:
            return str(val)
    return str(val)


def sanitize(attrs: Mapping[str, Any]) -> Dict[str, Any]:
    """Drops None values (absent != empty) and sanitizes the rest."""
    return {k: sanitize_value(v) for k, v in attrs.items() if v is not None}
