import threading
import time
import uuid
from collections import OrderedDict
from typing import List, Optional, Tuple

from memtrace.application.ports import SpanHandle


class RunRegistry:
    """In-flight spans by `run_id` (callback-based frameworks identify runs, not spans).

    Backed by an `OrderedDict` insertion-ordered by `run_id`: since runs are (almost) always
    added in creation order, the oldest entry is always the first one, making `pop_oldest` O(1)
    instead of a full scan.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: OrderedDict[uuid.UUID, Tuple[SpanHandle, float]] = OrderedDict()

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

    def pop_oldest(self) -> Optional[SpanHandle]:
        with self._lock:
            if not self._runs:
                return None
            _, (handle, _) = self._runs.popitem(last=False)
            return handle

    def pop_older_than(self, cutoff: float) -> List[SpanHandle]:
        with self._lock:
            stale = [rid for rid, (_, created) in self._runs.items() if created < cutoff]
            return [self._runs.pop(rid)[0] for rid in stale]

    def __len__(self) -> int:
        with self._lock:
            return len(self._runs)
