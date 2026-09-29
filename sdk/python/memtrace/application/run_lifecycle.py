"""Bounds the lifetime of in-flight runs, independently of the use cases in `TracingService`.

Two concerns, both about runs that never get an explicit `end_run` (a crashed process, a
framework callback that never fires):

* **TTL expiry**: a background daemon thread closes runs older than `ttl_seconds` even when no
  new spans arrive to trigger the check.
* **Capacity enforcement**: under heavy traffic, closes the oldest in-flight run once
  `max_active_runs` is reached, so memory stays bounded.
"""
import logging
import threading
import time
from typing import Optional

from memtrace.application.ports import SpanHandle
from memtrace.application.run_registry import RunRegistry
from memtrace.domain import semconv as sc

logger = logging.getLogger("memtrace")

_EXPIRE_CHECK_INTERVAL_SECONDS = 10


class RunLifecycleGuard:
    """Owns TTL expiry, capacity enforcement and the reaper thread for one `RunRegistry`."""

    def __init__(self, registry: RunRegistry, ttl_seconds: int, max_active_runs: int) -> None:
        self._registry = registry
        self._ttl = ttl_seconds
        self._max_active_runs = max_active_runs
        self._last_expire_check = time.time()
        self._eviction_warned = False
        self._reaper_lock = threading.Lock()
        self._reaper: Optional[threading.Thread] = None
        self._stop = threading.Event()

    def before_start(self) -> None:
        """Call once per new run, before registering it: keeps TTL/capacity enforced proactively
        even if the reaper thread has not ticked yet."""
        self._expire_stale_if_due()
        self._ensure_reaper()
        self._enforce_capacity()

    def expire_stale(self, now: Optional[float] = None) -> None:
        """Ends the spans that exceeded the TTL (end callbacks that never arrived)."""
        now = time.time() if now is None else now
        self._last_expire_check = now
        for handle in self._registry.pop_older_than(now - self._ttl):
            self._close_expired(handle)

    def shutdown(self) -> None:
        self._stop.set()

    def _expire_stale_if_due(self) -> None:
        if time.time() - self._last_expire_check >= _EXPIRE_CHECK_INTERVAL_SECONDS:
            self.expire_stale()

    def _enforce_capacity(self) -> None:
        while len(self._registry) >= self._max_active_runs > 0:
            handle = self._registry.pop_oldest()
            if handle is None:
                return
            if not self._eviction_warned:
                self._eviction_warned = True
                logger.warning(
                    "[MemTrace] More than %d spans in flight; closing the oldest ones early "
                    "(raise MEMTRACE_MAX_ACTIVE_RUNS if this is expected).",
                    self._max_active_runs,
                )
            self._close_expired(handle)

    def _ensure_reaper(self) -> None:
        """Starts (once) the daemon thread that expires orphans even when no new spans arrive."""
        if self._reaper is not None or self._ttl <= 0 or self._stop.is_set():
            return
        with self._reaper_lock:
            if self._reaper is None:
                thread = threading.Thread(target=self._reap_loop, name="memtrace-reaper", daemon=True)
                self._reaper = thread
                thread.start()

    def _reap_loop(self) -> None:
        interval = min(_EXPIRE_CHECK_INTERVAL_SECONDS, max(self._ttl / 4, 0.05))
        while not self._stop.wait(interval):
            self.expire_stale()

    @staticmethod
    def _close_expired(handle: SpanHandle) -> None:
        try:
            handle.set_attributes({sc.MEMTRACE_SPAN_EXPIRED: True})
            handle.end()
        except Exception:
            pass
