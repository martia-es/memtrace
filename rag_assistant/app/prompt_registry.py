"""El prompt del asistente leído del registro de MemTrace (opcional).

Se activa con `MEMTRACE_API_URL` (con el id del experimento) y `MEMTRACE_API_KEY`. Si el prompt aún no existe en MemTrace, el
asistente arranca con su texto por defecto y lo dice en `/api/prompt`: créalo y reinicia.
"""

import logging
import os

from memtrace import prompts
from memtrace.prompts import PromptHandle, PromptNotFoundError

logger = logging.getLogger(__name__)

DEFAULT_PROMPT_NAME = "faq-system"
# sin MEMTRACE_ENVIRONMENT el SDK no sabe qué tag seguir: el asistente de ejemplo sigue `dev`
DEFAULT_TAG = "dev"


def prompt_name() -> str:
    return os.getenv("RAG_ASSISTANT_PROMPT", DEFAULT_PROMPT_NAME)


def load_prompt(default: str) -> PromptHandle | None:
    """Bloquea unos segundos como mucho: llamarla fuera del bucle de eventos (`asyncio.to_thread`)."""
    if not os.getenv("MEMTRACE_API_URL"):
        logger.info("Prompt del registro desactivado: falta MEMTRACE_API_URL")
        return None
    tag = None if os.getenv("MEMTRACE_ENVIRONMENT") else os.getenv("RAG_ASSISTANT_PROMPT_TAG", DEFAULT_TAG)
    try:
        return prompts.get(prompt_name(), tag=tag, default=default)
    except PromptNotFoundError as error:
        logger.warning("El prompt no existe en MemTrace (%s): se usa el texto por defecto hasta que lo crees y reinicies", error)
        return None
