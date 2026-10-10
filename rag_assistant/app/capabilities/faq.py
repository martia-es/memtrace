"""Capability de FAQs: busca en la base de conocimiento y devuelve fragmentos con su fuente."""

from memtrace import record_retrieved_chunks, trace_step_context
from pydantic_ai import RunContext

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability
from app.knowledge.retriever import Hit

# BM25 no está normalizado: una palabra suelta que casualmente aparece en una FAQ («tiempo», «vuelo») puntúa lo bastante
# para colarse. Por eso, además de una puntuación mínima, se exige que coincidan al menos dos términos de la pregunta
# (o el único que tenga): es mejor decir «no lo sé» que responder con un fragmento que no viene al caso. A cambio, cada FAQ
# debe recoger las palabras con que la gente pregunta (su campo `keywords`); con embeddings esto dejaría de hacer falta.
MIN_SCORE = 1.5
MIN_MATCHED_TERMS = 2


def is_relevant(hit: Hit) -> bool:
    return hit.score >= MIN_SCORE and hit.matched >= min(MIN_MATCHED_TERMS, hit.query_terms)


async def search_faqs(ctx: RunContext[AssistantDeps], query: str, top_k: int = 3) -> dict:
    """Busca en las preguntas frecuentes de la empresa y devuelve los fragmentos más relevantes.

    Args:
        query: La pregunta del usuario, reformulada con sus palabras clave (p. ej. "peso máximo equipaje de mano").
        top_k: Cuántos fragmentos devolver (1 a 5). Por defecto 3.
    """
    top_k = max(1, min(top_k, 5))
    # el span `retriever` es el que lee MemTrace para sus métricas de recuperación (ADR-044)
    with trace_step_context("retrieve_faqs", step_type="retriever"):
        hits = [hit for hit in ctx.deps.retriever.search(query, top_k) if is_relevant(hit)]
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
