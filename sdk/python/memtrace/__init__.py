import logging

from memtrace._version import __version__
from memtrace.adapters.inbound.decorators import trace_llm_call, trace_step, trace_step_context
from memtrace.adapters.inbound.langchain import MemTraceCallbackHandler
from memtrace.application.context import get_current_run_id, session
from memtrace.dependency_container import flush, init_tracer, shutdown

logger = logging.getLogger("memtrace")

__all__ = [
    "__version__",
    "init_tracer",
    "flush",
    "shutdown",
    "session",
    "trace_step",
    "trace_step_context",
    "trace_llm_call",
    "get_current_run_id",
    "MemTraceCallbackHandler",
    "enable_langchain_instrumentation",
]


def enable_langchain_instrumentation() -> None:
    """Activa la autoinstrumentación automática de LangChain / LangGraph.

    Requiere: pip install memtrace[otel-langchain]

    Nota: esta es una alternativa a usar MemTraceCallbackHandler. Elige una:
    - Automática: enable_langchain_instrumentation() (sin cambios de código)
    - Manual: agent.invoke(..., callbacks=[MemTraceCallbackHandler()])
    """
    try:
        from opentelemetry.instrumentation.langchain import LangChainInstrumentor

        instrumentor = LangChainInstrumentor()
        instrumentor.instrument()
        logger.info("[MemTrace] Autoinstrumentación de LangChain activada")
    except ImportError as e:
        logger.warning(
            "[MemTrace] LangChain instrumentation requiere: "
            "pip install opentelemetry-instrumentation-langchain"
        )
        raise ImportError(
            "LangChain instrumentation requires: "
            "pip install opentelemetry-instrumentation-langchain"
        ) from e
