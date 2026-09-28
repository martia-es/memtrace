"""Automatic LangChain / LangGraph instrumentation through OpenTelemetry's instrumentor."""
import logging
import os
from typing import Optional

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service

logger = logging.getLogger("memtrace")

_INSTALL_HINT = "pip install 'memtrace-ai[otel-langchain]'"
_CONTENT_ENV = "TRACELOOP_TRACE_CONTENT"  # honored by opentelemetry-instrumentation-langchain


def enable_langchain_instrumentation(service: Optional[TracingService] = None) -> None:
    """Enables automatic LangChain / LangGraph instrumentation (no callbacks needed).

    Requires: pip install 'memtrace-ai[otel-langchain]'. Raises ImportError if it is missing.

    Spans go to the tracer configured by `init_tracer`, and prompts/completions are only
    recorded when MEMTRACE_CAPTURE_CONTENT=true. Safe to call more than once. It is an alternative to
    MemTraceCallbackHandler; use one of them, not both, or every run is traced twice.
    """
    try:
        from opentelemetry.instrumentation.langchain import LangchainInstrumentor
    except ImportError as exc:
        raise ImportError(f"LangChain instrumentation requires: {_INSTALL_HINT}") from exc

    service = service or get_service()
    provider = service.tracer_provider  # process-wide, survives shutdown()/init_tracer()
    if provider is None:
        logger.info("[MemTrace] Tracing is off; LangChain instrumentation not enabled.")
        return

    # Respect the privacy default of ADR-004 unless the user set the instrumentor's own switch
    os.environ.setdefault(_CONTENT_ENV, "true" if service.captures_content else "false")

    instrumentor = LangchainInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        # Already bound to MemTrace's switchable provider, which follows init_tracer()/shutdown()
        logger.debug("[MemTrace] LangChain auto-instrumentation was already enabled")
        return
    instrumentor.instrument(tracer_provider=provider)
    logger.info("[MemTrace] LangChain auto-instrumentation enabled")
