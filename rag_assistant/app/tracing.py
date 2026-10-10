"""Trazas MemTrace del agente. Se activan solo si hay credenciales de experimento.

El experimento se elige con la API key de su cabecera: `RAG_ASSISTANT_MEMTRACE_HEADERS`
(formato `authorization=Bearer mtk_...`). Si no está definida, el asistente no envía trazas.
"""

import logging
import os

from memtrace import init_tracer
from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation

logger = logging.getLogger(__name__)


def setup_tracing() -> bool:
    raw_headers = os.getenv("RAG_ASSISTANT_MEMTRACE_HEADERS")
    if not raw_headers:
        logger.info("MemTrace desactivado: falta RAG_ASSISTANT_MEMTRACE_HEADERS")
        return False

    headers = dict(
        part.split("=", 1) for part in raw_headers.split(",") if "=" in part
    )
    init_tracer(
        service_name=os.getenv("RAG_ASSISTANT_SERVICE_NAME", "rag-assistant"),
        endpoint=os.getenv("RAG_ASSISTANT_MEMTRACE_ENDPOINT", "http://localhost:8080/api/v1/ingest"),
        protocol="http/protobuf",
        headers={k.strip(): v.strip() for k, v in headers.items()},
    )
    enable_pydantic_ai_instrumentation()
    return True
