from __future__ import annotations

from typing import Any, ContextManager, Mapping, Optional

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from memtrace.adapters.outbound.otel.attribute_sanitizer import sanitize
from memtrace.application.ports import SpanHandle


class OtelSpanHandle:
    def __init__(self, span: Any) -> None:
        self.span = span

    @property
    def trace_id(self) -> Optional[str]:
        context = self.span.get_span_context()
        return format(context.trace_id, "032x") if context.is_valid else None

    def set_attributes(self, attributes: Mapping[str, Any]) -> None:
        self.span.set_attributes(sanitize(attributes))

    def end(self, error: Optional[BaseException] = None) -> None:
        try:
            if error is None:
                self.span.set_status(Status(StatusCode.OK))
            else:
                if isinstance(error, Exception):  # BaseException (cancellation): no stack trace
                    self.span.record_exception(error)
                self.span.set_status(Status(StatusCode.ERROR, str(error) or type(error).__name__))
        finally:
            self.span.end()


class OtelSpanAdapter:
    """Implements `SpanPort` on top of the OpenTelemetry SDK."""

    def __init__(self, tracer: Any, provider: Any, shared_provider: Any = None) -> None:
        self._tracer = tracer
        self._provider = provider
        self._shared = shared_provider

    def start_span(self, name: str, attributes: Mapping[str, Any], parent: Optional[SpanHandle] = None) -> SpanHandle:
        ctx = trace.set_span_in_context(parent.span) if isinstance(parent, OtelSpanHandle) else None
        handle = OtelSpanHandle(self._tracer.start_span(name=name, context=ctx))  # ctx=None: current context
        handle.set_attributes(attributes)
        return handle

    def activate(self, span: SpanHandle) -> ContextManager[Any]:
        assert isinstance(span, OtelSpanHandle)
        return trace.use_span(
            span.span, end_on_exit=False, record_exception=False, set_status_on_exception=False
        )

    def current(self) -> Optional[SpanHandle]:
        span = trace.get_current_span()
        return OtelSpanHandle(span) if span.is_recording() else None

    @property
    def tracer_provider(self) -> Any:
        return self._shared if self._shared is not None else self._provider

    def flush(self, timeout_millis: int = 30000) -> bool:
        return bool(self._provider.force_flush(timeout_millis))

    def shutdown(self) -> None:
        if self._shared is not None and self._shared.target is self._provider:
            self._shared.target = None
        self._provider.shutdown()
