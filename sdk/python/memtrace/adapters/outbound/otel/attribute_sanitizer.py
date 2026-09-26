import json
from typing import Any, Dict, Mapping

_PRIMITIVES = (bool, str, int, float)


def sanitize_value(val: Any) -> Any:
    """Tipo válido de atributo OTel: primitivo o secuencia homogénea; el resto, JSON/str."""
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
    """Descarta los None (ausente != vacío) y sanea el resto."""
    return {k: sanitize_value(v) for k, v in attrs.items() if v is not None}
