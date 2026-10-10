"""Capability de FAQs: busca en la base de conocimiento y devuelve fragmentos con su fuente."""

import asyncio

from memtrace import record_retrieved_chunks, trace_step_context
from pydantic_ai import RunContext

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability

async def search_faqs(ctx: RunContext[AssistantDeps], query: str, top_k: int = 3) -> dict:
    """Busca en las preguntas frecuentes de la empresa y devuelve los fragmentos más relevantes.

    Args:
        query: La pregunta del usuario, reformulada con sus palabras clave (p. ej. "peso máximo equipaje de mano").
        top_k: Cuántos fragmentos devolver (1 a 5). Por defecto 3.
    """
    top_k = max(1, min(top_k, 5))
    # el span `retriever` es el que lee MemTrace para sus métricas de recuperación (ADR-044)
    with trace_step_context("retrieve_faqs", step_type="retriever"):
        # la búsqueda puede llamar a la API de embeddings: fuera del bucle de eventos
        found = await asyncio.to_thread(ctx.deps.retriever.search, query, top_k)
        hits = [hit for hit in found if hit.relevant]
        record_retrieved_chunks(
            [{"id": hit.entry.id, "source": hit.entry.title, "score": hit.score, "text": hit.entry.text} for hit in hits]
        )
    if not hits:
        return {"results": [], "note": "No hay información sobre esto en las preguntas frecuentes."}
    return {"results": [{"id": hit.entry.id, "title": hit.entry.title, "text": hit.entry.text} for hit in hits]}


faq_capability = Capability(
    name="faq",
    description="Preguntas frecuentes de la empresa (búsqueda sobre su base de conocimiento)",
    instructions=(
        "Para cualquier pregunta sobre la empresa, sus servicios o sus políticas, llama SIEMPRE a `search_faqs` antes de responder. "
        "Responde solo con lo que digan los resultados, en el idioma del usuario y de forma breve; no inventes cifras, plazos ni precios. "
        "Si los resultados no cubren la pregunta, o no hay ninguno, dilo con claridad y sugiere contactar con atención al cliente. "
        "No llames a la herramienta para saludos o agradecimientos. No tienes acceso a reservas ni datos personales: "
        "si piden consultar o modificar una reserva concreta, explica cómo hacerlo ellos mismos según las FAQs."
    ),
    tools=[search_faqs],
)
