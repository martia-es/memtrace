from __future__ import annotations

from typing import Any, ContextManager, Mapping, Optional

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from memtrace.adapters.outbound.otel.attribute_sanitizer import sanitize
from memtrace.application.ports import SpanHandle


class OtelSpanHandle:
    def __init__(self, span: Any) -> None:
        self.span = span

    def set_attributes(self, attributes: Mapping[str, Any]) -> None:
        self.span.set_attributes(sanitize(attributes))

    def end(self, error: Optional[BaseException] = None) -> None:
        try:
            if error is None:
                self.span.set_status(Status(StatusCode.OK))
            else:
                if isinstance(error, Exception):  # BaseException (cancelación): sin stacktrace
                    self.span.record_exception(error)
                self.span.set_status(Status(StatusCode.ERROR, str(error) or type(error).__name__))
        finally:
            self.span.end()


class OtelSpanAdapter:
    """Implementa `SpanPort` sobre el SDK de OpenTelemetry."""

    def __init__(self, tracer: Any, provider: Any) -> None:
        self._tracer = tracer
        self._provider = provider

    def start_span(self, name: str, attributes: Mapping[str, Any], parent: Optional[SpanHandle] = None) -> SpanHandle:
        ctx = trace.set_span_in_context(parent.span) if isinstance(parent, OtelSpanHandle) else None
        handle = OtelSpanHandle(self._tracer.start_span(name=name, context=ctx))  # ctx=None: contexto actual
        handle.set_attributes(attributes)
        return handle

    def activate(self, span: SpanHandle) -> ContextManager[None]:
        return trace.use_span(
            span.span, end_on_exit=False, record_exception=False, set_status_on_exception=False
        )

    def current(self) -> Optional[SpanHandle]:
        span = trace.get_current_span()
        return OtelSpanHandle(span) if span.is_recording() else None

    def flush(self, timeout_millis: int = 30000) -> bool:
        return bool(self._provider.force_flush(timeout_millis))

    def shutdown(self) -> None:
        self._provider.shutdown()
