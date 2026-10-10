"""One call to send every OpenAI Agents SDK run to MemTrace."""
import logging
from typing import Optional

from memtrace.application.tracing_service import TracingService

logger = logging.getLogger("memtrace")

_INSTALL_HINT = "pip install 'memtrace-ai[openai-agents]'"
_installed: Optional[object] = None


def enable_openai_agents_instrumentation(service: Optional[TracingService] = None, *, keep_openai_export: bool = True) -> None:
    """Registers a MemTrace tracing processor with the OpenAI Agents SDK, for all agents.

    Requires: pip install 'memtrace-ai[openai-agents]'. Raises ImportError if it is missing. Safe to call more than once.

    `keep_openai_export`: the Agents SDK also uploads its traces to the OpenAI dashboard by default. `True` (default) keeps
    that; `False` replaces it, so traces only go to MemTrace. Prompts and completions are recorded only with
    MEMTRACE_CAPTURE_CONTENT=true.
    """
    global _installed
    try:
        from agents import add_trace_processor, set_trace_processors
    except ImportError as exc:
        raise ImportError(f"OpenAI Agents instrumentation requires: {_INSTALL_HINT}") from exc
    from memtrace.adapters.inbound.openai_agents.callback import MemTraceTracingProcessor

    if _installed is not None:
        logger.debug("[MemTrace] OpenAI Agents instrumentation was already enabled")
        return
    processor = MemTraceTracingProcessor(service)
    (add_trace_processor if keep_openai_export else lambda p: set_trace_processors([p]))(processor)
    _installed = processor
    logger.info("[MemTrace] OpenAI Agents instrumentation enabled")
