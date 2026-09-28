import logging
from typing import Any, Sequence

from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import Status

from memtrace.domain import semconv as sc
from memtrace.domain.attributes import infer_step_type
from memtrace.domain.redaction import Redactor

logger = logging.getLogger("memtrace")


class SanitizingSpanExporter(SpanExporter):
    """Last stop before a span leaves the process (ADR-021).

    Wraps the real exporter and, for **every** span whatever its origin (MemTrace decorators,
    the LangChain handler, Pydantic AI, any auto-instrumented library):

    * redacts secrets in attributes, event attributes (exceptions included) and the status message;
    * fills `memtrace.step_type` on spans that lack it, from their standard GenAI attributes.

    If sanitizing a span fails, it is exported without attributes or events rather than raw.
    """

    def __init__(self, inner: SpanExporter, redactor: Redactor) -> None:
        self._inner = inner
        self._redactor = redactor

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        return self._inner.export([self._sanitize(span) for span in spans])

    def shutdown(self) -> None:
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return bool(self._inner.force_flush(timeout_millis))

    def _sanitize(self, span: ReadableSpan) -> ReadableSpan:
        try:
            redact = self._redactor.attribute
            attributes = {k: redact(k, v) for k, v in (span.attributes or {}).items()}
            if sc.MEMTRACE_STEP_TYPE not in attributes:
                inferred = infer_step_type(attributes)
                if inferred:
                    attributes[sc.MEMTRACE_STEP_TYPE] = inferred
            events = [
                Event(e.name, {k: redact(k, v) for k, v in (e.attributes or {}).items()}, e.timestamp)
                for e in span.events
            ]
            status = span.status
            if status.description:
                status = Status(status.status_code, self._redactor.scrub_text(status.description))
            return self._copy(span, attributes, events, status)
        except Exception as exc:
            logger.warning("[MemTrace] Could not sanitize span %r; exporting it without content: %s", span.name, exc)
            return self._copy(span, {"memtrace.redaction_failed": True}, [], Status(span.status.status_code))

    @staticmethod
    def _copy(span: ReadableSpan, attributes: Any, events: Any, status: Status) -> ReadableSpan:
        return ReadableSpan(
            name=span.name,
            context=span.context,
            parent=span.parent,
            resource=span.resource,
            attributes=attributes,
            events=events,
            links=span.links,
            kind=span.kind,
            status=status,
            start_time=span.start_time,
            end_time=span.end_time,
            instrumentation_scope=span.instrumentation_scope,
        )
