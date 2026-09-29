"""Shared plumbing for "auto" instrumentors (LangChain, Pydantic AI…): each just points a
third-party library at the tracer provider configured by `init_tracer`, no callbacks needed.
"""
import logging
from typing import Any, Optional, Tuple

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service

logger = logging.getLogger("memtrace")


def resolve_tracer_provider(feature: str, service: Optional[TracingService] = None) -> Tuple[TracingService, Optional[Any]]:
    """The `(service, tracer_provider)` to instrument with, or `(service, None)` if tracing is off.

    `feature`: human-readable name for the log line (e.g. "LangChain", "Pydantic AI").
    """
    service = service or get_service()
    provider = service.tracer_provider
    if provider is None:
        logger.info("[MemTrace] Tracing is off; %s instrumentation not enabled.", feature)
    return service, provider
