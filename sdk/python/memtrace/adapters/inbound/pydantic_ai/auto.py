"""Automatic Pydantic AI instrumentation.

Pydantic AI emits OpenTelemetry spans by itself, without callbacks. This module points it at
the tracer configured by `init_tracer`.
"""
import logging
from typing import Optional

from memtrace.adapters.inbound.auto_instrumentation import resolve_tracer_provider
from memtrace.application.tracing_service import TracingService

logger = logging.getLogger("memtrace")


def enable_pydantic_ai_instrumentation(service: Optional[TracingService] = None) -> None:
    """Enables automatic Pydantic AI instrumentation for all agents.

    Requires: pip install 'memtrace-ai[pydantic-ai]'. Raises ImportError if it is missing.

    Spans go to the tracer configured by `init_tracer`, and prompts/completions are only
    recorded when MEMTRACE_CAPTURE_CONTENT=true.
    """
    try:
        from pydantic_ai import Agent, InstrumentationSettings
    except ImportError as exc:
        raise ImportError(
            "Pydantic AI instrumentation requires: pip install 'memtrace-ai[pydantic-ai]'"
        ) from exc

    service, provider = resolve_tracer_provider("Pydantic AI", service)
    if provider is None:
        return

    Agent.instrument_all(
        InstrumentationSettings(tracer_provider=provider, include_content=service.captures_content)
    )
    logger.info("[MemTrace] Pydantic AI auto-instrumentation enabled")
