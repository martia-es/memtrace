"""Instrumentación automática de Pydantic AI con OpenTelemetry.

Pydantic AI emite spans OTel directamente, sin necesidad de callbacks.
Este módulo activa la instrumentación con el tracer que configuró init_tracer.
"""
import logging

logger = logging.getLogger("memtrace")


def enable_pydantic_ai_instrumentation() -> None:
    """Activa la autoinstrumentación de Pydantic AI.

    Requiere: pip install memtrace-ai[pydantic-ai]

    Usa el TracerProvider que configuró init_tracer, sin cambios de código.
    """
    try:
        from pydantic_ai import Agent

        Agent.instrument_all()
        logger.info("[MemTrace] Autoinstrumentación de Pydantic AI activada")
    except (ImportError, AttributeError) as e:
        logger.warning(
            "[MemTrace] Pydantic AI instrumentation requiere: pip install pydantic-ai"
        )
        raise ImportError(
            "Pydantic AI instrumentation requires: pip install pydantic-ai"
        ) from e
