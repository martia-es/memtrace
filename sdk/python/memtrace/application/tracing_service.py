from __future__ import annotations

import functools
import logging
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Mapping, Optional, Sequence, Union

from memtrace.application.context import current_run_id, get_session_id
from memtrace.application.ports import SpanPort
from memtrace.application.run_lifecycle import RunLifecycleGuard
from memtrace.application.run_registry import RunRegistry
from memtrace.domain import semconv as sc
from memtrace.application.retrieval_capture import note_retrieved
from memtrace.domain.attributes import llm_attributes, retrieved_chunks, step_start_attributes
from memtrace.domain.model import CapturePolicy, LlmCall, StepType

logger = logging.getLogger("memtrace")


def _failsafe(default: Any = None):
    """Central policy: instrumentation never propagates exceptions into user code."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(self, *args, **kwargs):
            try:
                return fn(self, *args, **kwargs)
            except Exception as exc:
                logger.warning("[MemTrace] %s failed: %s", fn.__name__, exc, exc_info=logger.isEnabledFor(logging.DEBUG))
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
        self._registry = RunRegistry()
        self._lifecycle = RunLifecycleGuard(self._registry, span_ttl_seconds, max_active_runs)

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
        self._lifecycle.before_start()
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

    @_failsafe()
    def current_trace_id(self) -> Optional[str]:
        """Trace id of the current span (None when there is none or tracing is off)."""
        handle = self._port.current()
        return handle.trace_id if handle is not None else None

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

    @_failsafe()
    def record_retrieved_chunks(self, documents: Sequence[Any]) -> None:
        """Annotates the current (retriever) span with the chunks it returned (ADR-044).

        The count is always recorded; the chunk text only when content capture is enabled (it is content).
        """
        handle = self._port.current()
        if handle is None:
            return
        chunks = retrieved_chunks(documents)
        note_retrieved(chunks)
        handle.set_attributes({sc.MEMTRACE_RETRIEVER_DOCUMENTS: len(chunks), sc.MEMTRACE_RETRIEVER_CHUNKS: self.capture(chunks)})

    # ----- maintenance -----

    @_failsafe()
    def expire_stale(self, now: Optional[float] = None) -> None:
        """Ends the spans that exceeded the TTL (end callbacks that never arrived)."""
        self._lifecycle.expire_stale(now)

    @_failsafe(default=False)
    def flush(self, timeout_millis: int = 30000) -> bool:
        return bool(self._port.flush(timeout_millis))

    @_failsafe()
    def shutdown(self) -> None:
        self._lifecycle.shutdown()
        self._port.shutdown()
