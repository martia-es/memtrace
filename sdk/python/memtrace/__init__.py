import logging

from memtrace._version import __version__
from memtrace.adapters.inbound.decorators import (
    trace_llm_call,
    trace_step,
    trace_step_context,
)
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
    "enable_pydantic_ai_instrumentation",
]


def enable_langchain_instrumentation() -> None:
    """Activa la autoinstrumentación automática de LangChain / LangGraph.

    Requiere: pip install memtrace[otel-langchain]

    Nota: esta es una alternativa a usar MemTraceCallbackHandler. Elige una:
    - Automática: enable_langchain_instrumentation() (sin cambios de código)
    - Manual: agent.invoke(..., callbacks=[MemTraceCallbackHandler()])
    """
    try:
        from opentelemetry.instrumentation import langchain as langchain_instrumentation

        instrumentor_cls = None
        for class_name in ("LangChainInstrumentor", "LangchainInstrumentor"):
            instrumentor_cls = getattr(langchain_instrumentation, class_name, None)
            if instrumentor_cls is not None:
                break

        if instrumentor_cls is None:
            raise AttributeError(
                "No se encontró una clase instrumentor de LangChain en "
                "opentelemetry.instrumentation.langchain"
            )

        instrumentor = instrumentor_cls()
        instrumentor.instrument()
        logger.info("[MemTrace] Autoinstrumentación de LangChain activada")
    except (ImportError, AttributeError) as e:
        logger.warning(
            "[MemTrace] LangChain instrumentation requiere: "
            "pip install opentelemetry-instrumentation-langchain"
        )
        raise ImportError(
            "LangChain instrumentation requires: "
            "pip install opentelemetry-instrumentation-langchain"
        ) from e


def enable_pydantic_ai_instrumentation() -> None:
    """Activa la autoinstrumentación automática de Pydantic AI.

    Requiere: pip install pydantic-ai

    Usa el TracerProvider que configuró init_tracer, sin cambios de código.
    """
    from memtrace.adapters.inbound.pydantic_ai import enable_pydantic_ai_instrumentation as _enable

    _enable()
