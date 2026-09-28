from __future__ import annotations

import functools
import logging
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Mapping, Optional, Sequence, Union

from memtrace.application.context import current_run_id, get_session_id
from memtrace.application.ports import SpanPort
from memtrace.application.run_registry import RunRegistry
from memtrace.domain import semconv as sc
from memtrace.domain.attributes import llm_attributes, step_start_attributes
from memtrace.domain.model import CapturePolicy, LlmCall, StepType

logger = logging.getLogger("memtrace")

_EXPIRE_CHECK_INTERVAL_SECONDS = 10


def _failsafe(default: Any = None):
    """Central policy: instrumentation never propagates exceptions into user code."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(self, *args, **kwargs):
            try:
                return fn(self, *args, **kwargs)
            except Exception as exc:
                logger.warning("[MemTrace] %s failed: %s", fn.__name__, exc)
                return default

        return wrapper

    return decorator


class TracingService:
    """Tracing use cases. Inbound adapters (decorators, LangChain…) only talk to this."""

    def __init__(
        self,
        port: SpanPort,
        capture: Optional[CapturePolicy] = None,
        span_ttl_seconds: int = 3600,
        max_active_runs: int = 10_000,
    ) -> None:
        self._port = port
        self._capture = capture or CapturePolicy()
        self._ttl = span_ttl_seconds
        self._max_active_runs = max_active_runs
        self._registry = RunRegistry()
        self._last_expire_check = time.time()
        self._eviction_warned = False
        self._reaper_lock = threading.Lock()
        self._reaper: Optional[threading.Thread] = None
        self._stop = threading.Event()

    @property
    def tracer_provider(self) -> Any:
        """Backend-native tracer provider for auto-instrumentors (None when tracing is off)."""
        return self._port.tracer_provider

    # ----- content policy -----

    @property
    def captures_content(self) -> bool:
        return self._capture.enabled

    @property
    def max_content_length(self) -> int:
        return self._capture.max_length

    def capture(self, payload: Any) -> Optional[str]:
        return self._capture.apply(payload)

    # ----- runs (spans identified by run_id) -----

    @property
    def active_runs(self) -> int:
        return len(self._registry)

    @_failsafe()
    def start_run(
        self,
        name: str,
        step_type: Union[StepType, str] = StepType.CHAIN,
        run_id: Optional[uuid.UUID] = None,
        parent_run_id: Optional[uuid.UUID] = None,
        attributes: Optional[Mapping[str, Any]] = None,
    ) -> uuid.UUID:
        """Parent: the `parent_run_id` run if still in flight; else the current span; else a root."""
        run_id = run_id or uuid.uuid4()
        self.expire_stale_if_due()
        self._ensure_reaper()
        self._enforce_capacity()
        parent = self._registry.get(parent_run_id) if parent_run_id else None
        # a None value must not override default attributes (e.g. the active session)
        explicit = {k: v for k, v in (attributes or {}).items() if v is not None}
        attrs = {**step_start_attributes(step_type, get_session_id()), **explicit}
        self._registry.add(run_id, self._port.start_span(name, attrs, parent))
        return run_id

    @_failsafe()
    def end_run(
        self,
        run_id: uuid.UUID,
        error: Optional[BaseException] = None,
        attributes: Optional[Mapping[str, Any]] = None,
    ) -> None:
        handle = self._registry.pop(run_id)
        if handle is None:
            return
        try:
            if attributes:
                handle.set_attributes(attributes)
        finally:
            handle.end(error)

    @_failsafe()
    def annotate_run(self, run_id: Optional[uuid.UUID], attributes: Mapping[str, Any]) -> None:
        handle = self._registry.get(run_id) if run_id else None
        if handle is not None:
            handle.set_attributes(attributes)

    @contextmanager
    def step(
        self,
        name: str,
        step_type: Union[StepType, str] = StepType.CHAIN,
        attributes: Optional[Mapping[str, Any]] = None,
    ) -> Iterator[Optional[uuid.UUID]]:
        """Instrumented block: its span is the *current* one inside it (children hang from it).

        Yields the `run_id`, or None if the span could not be opened (the block runs anyway).
        """
        opened = self._open_step(name, step_type, attributes)
        if opened is None:
            yield None
            return
        run_id, activation, token = opened
        try:
            yield run_id
        except BaseException as exc:  # includes CancelledError / KeyboardInterrupt
            self._close_step(run_id, activation, token, exc)
            raise
        self._close_step(run_id, activation, token, None)

    @_failsafe()
    def _open_step(self, name, step_type, attributes):
        run_id = self.start_run(name, step_type, attributes=attributes)
        handle = self._registry.get(run_id) if run_id else None
        if handle is None:
            return None
        try:
            activation = self._port.activate(handle)
            activation.__enter__()
        except Exception:
            self.end_run(run_id)  # do not leave the span orphaned
            raise
        return run_id, activation, current_run_id.set(run_id)

    @_failsafe()
    def _close_step(self, run_id, activation, token, error) -> None:
        try:
            activation.__exit__(None, None, None)
        finally:
            try:
                current_run_id.reset(token)
            finally:
                self.end_run(run_id, error=error)

    # ----- llm -----

    @_failsafe()
    def record_llm_call(
        self,
        call: LlmCall,
        input_messages: Optional[Sequence[Any]] = None,
        output_messages: Optional[Sequence[Any]] = None,
        extra_attributes: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Annotates the current span with an LLM call."""
        handle = self._port.current()
        if handle is None:
            return
        attrs = llm_attributes(call, self.capture(input_messages), self.capture(output_messages))
        attrs.update(extra_attributes or {})
        handle.set_attributes(attrs)

    # ----- maintenance -----

    def expire_stale_if_due(self) -> None:
        if time.time() - self._last_expire_check >= _EXPIRE_CHECK_INTERVAL_SECONDS:
            self.expire_stale()

    @_failsafe()
    def expire_stale(self, now: Optional[float] = None) -> None:
        """Ends the spans that exceeded the TTL (end callbacks that never arrived)."""
        now = time.time() if now is None else now
        self._last_expire_check = now
        for handle in self._registry.pop_older_than(now - self._ttl):
            try:
                handle.set_attributes({sc.MEMTRACE_SPAN_EXPIRED: True})
                handle.end()
            except Exception:
                pass

    def _enforce_capacity(self) -> None:
        """Bounds memory under heavy traffic: the oldest in-flight run is closed as expired."""
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
            try:
                handle.set_attributes({sc.MEMTRACE_SPAN_EXPIRED: True})
                handle.end()
            except Exception:
                pass

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

    @_failsafe(default=False)
    def flush(self, timeout_millis: int = 30000) -> bool:
        return bool(self._port.flush(timeout_millis))

    @_failsafe()
    def shutdown(self) -> None:
        self._stop.set()
        self._port.shutdown()
