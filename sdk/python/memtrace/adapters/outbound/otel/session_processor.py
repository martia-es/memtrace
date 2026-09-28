from typing import Optional

from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span, SpanProcessor

from memtrace.application.context import get_session_id
from memtrace.domain import semconv as sc

TRACER_NAME = "memtrace"


class SessionSpanProcessor(SpanProcessor):
    """Tags spans made by third-party instrumentation with the active `session()` id.

    Spans created through `TracingService` (tracer `memtrace`) already resolve their own
    conversation id, so they are left alone. Spans emitted by auto-instrumented libraries
    (Pydantic AI, LangChain's OTel instrumentor…) are overridden: opening a `session()` is an
    explicit request to group everything inside it, even if the library generated its own id.
    """

    def on_start(self, span: Span, parent_context: Optional[Context] = None) -> None:
        session_id = get_session_id()
        if not session_id:
            return
        scope = getattr(span, "instrumentation_scope", None)
        if scope is not None and scope.name == TRACER_NAME:
            return
        span.set_attribute(sc.GEN_AI_CONVERSATION_ID, session_id)

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        # Older SDK versions return None from the base class, which MultiSpanProcessor reads as failure
        return True
