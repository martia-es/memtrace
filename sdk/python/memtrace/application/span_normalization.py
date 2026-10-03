"""Port for filling standard GenAI attributes from framework-specific ones at export time.

An adapter registers a `SpanNormalizer` when its integration is enabled. The export pipeline
asks every registered normalizer for the attributes it can add. A normalizer never overwrites
an attribute that is already present.
"""

import threading
from typing import Any, Dict, List, Mapping, Protocol


class SpanNormalizer(Protocol):
    def normalize(self, attributes: Mapping[str, Any]) -> Dict[str, Any]:
        """Returns the standard attributes it can derive. Keys already in `attributes` are ignored."""
        ...


_lock = threading.Lock()
_normalizers: List[SpanNormalizer] = []


def register_span_normalizer(normalizer: SpanNormalizer) -> None:
    with _lock:
        if not any(type(n) is type(normalizer) for n in _normalizers):
            _normalizers.append(normalizer)


def active_span_normalizers() -> List[SpanNormalizer]:
    with _lock:
        return list(_normalizers)


def fill_missing(attributes: Mapping[str, Any], derived: Mapping[str, Any]) -> Dict[str, Any]:
    """Keeps only the derived keys that the span does not already have."""
    return {k: v for k, v in derived.items() if k not in attributes and v is not None}
