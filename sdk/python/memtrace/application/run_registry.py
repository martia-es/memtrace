import threading
import time
import uuid
from typing import Dict, List, Optional, Tuple

from memtrace.application.ports import SpanHandle


class RunRegistry:
    """Spans en vuelo por `run_id` (los frameworks por callbacks identifican runs, no spans)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: Dict[uuid.UUID, Tuple[SpanHandle, float]] = {}

    def add(self, run_id: uuid.UUID, handle: SpanHandle, created_at: Optional[float] = None) -> None:
        with self._lock:
            self._runs[run_id] = (handle, created_at if created_at is not None else time.time())

    def get(self, run_id: uuid.UUID) -> Optional[SpanHandle]:
        with self._lock:
            entry = self._runs.get(run_id)
        return entry[0] if entry else None

    def pop(self, run_id: uuid.UUID) -> Optional[SpanHandle]:
        with self._lock:
            entry = self._runs.pop(run_id, None)
        return entry[0] if entry else None

    def pop_older_than(self, cutoff: float) -> List[SpanHandle]:
        with self._lock:
            stale = [rid for rid, (_, created) in self._runs.items() if created < cutoff]
            return [self._runs.pop(rid)[0] for rid in stale]

    def __len__(self) -> int:
        with self._lock:
            return len(self._runs)
