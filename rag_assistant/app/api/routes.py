import asyncio
import logging
import uuid

import httpx
import memtrace
from fastapi import APIRouter, HTTPException, Request
from memtrace import trace_step_context
from pydantic_ai.messages import ModelMessage, ToolReturnPart

from app.agents.deps import AssistantDeps
from app.api.schemas import CapabilityInfo, ChatRequest, ChatResponse, FeedbackRequest, Source
from app.guardrails.input import run_input_guardrail

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def consulted_sources(messages: list[ModelMessage]) -> list[Source]:
    """FAQs que devolvió `search_faqs` en este turno, sin repetir y en orden de relevancia."""
    sources: dict[str, Source] = {}
    for message in messages:
        for part in message.parts:
            if isinstance(part, ToolReturnPart) and part.tool_name == "search_faqs" and isinstance(part.content, dict):
                for hit in part.content.get("results", []):
                    sources.setdefault(hit["id"], Source(id=hit["id"], title=hit["title"]))
    return list(sources.values())


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    state = request.app.state
    session_id = payload.session_id or str(uuid.uuid4())

    # Un solo span para el turno: el guardarraíl y el agente cuelgan de la misma traza (ADR-026).
    # `session` agrupa los turnos de esta sesión en una conversación de MemTrace (sin ella cada turno queda aislado).
    with memtrace.session(session_id), trace_step_context("conversation_turn", step_type="chain"):
        trace_id = memtrace.current_trace_id()
        verdict = run_input_guardrail(payload.message)
        if verdict.blocked:
            # el mensaje bloqueado no llega al agente ni se guarda en el historial
            return ChatResponse(session_id=session_id, reply=verdict.reply, blocked=True, trace_id=trace_id)

        history = await state.sessions.get_history(session_id)
        deps = AssistantDeps(retriever=state.retriever)
        result = await state.agent.run(payload.message, message_history=history, deps=deps)
        await state.sessions.save_history(session_id, result.all_messages())

    return ChatResponse(
        session_id=session_id,
        reply=result.output,
        sources=consulted_sources(result.new_messages()),
        trace_id=trace_id,
    )


@router.post("/chat/feedback", status_code=204)
async def chat_feedback(payload: FeedbackRequest) -> None:
    """Guarda en MemTrace el 👍/👎 del usuario sobre la traza de una respuesta (ADR-062).

    Usa `MEMTRACE_API_URL` (con el id del experimento) y `MEMTRACE_API_KEY`: la clave se queda en el servidor, nunca llega al navegador.
    """
    try:
        # `memtrace.feedback` es síncrona (httpx): fuera del bucle de eventos para no bloquear el chat
        await asyncio.to_thread(
            memtrace.feedback,
            payload.trace_id,
            payload.rating,
            end_user_id=payload.session_id,
            comment=payload.comment,
        )
    except ValueError as error:  # falta MEMTRACE_API_URL
        raise HTTPException(status_code=503, detail="El feedback no está configurado") from error
    except httpx.HTTPError as error:
        logger.warning("MemTrace rechazó el feedback: %s", error)
        raise HTTPException(status_code=502, detail="No se pudo guardar el feedback") from error


@router.delete("/sessions/{session_id}", status_code=204)
async def clear_session(session_id: str, request: Request) -> None:
    if not await request.app.state.sessions.clear(session_id):
        raise HTTPException(status_code=404, detail="Sesión no encontrada")


@router.get("/prompt")
async def current_prompt(request: Request) -> dict[str, object]:
    """Qué prompt usa el asistente ahora: el del registro de MemTrace (y su versión) o el texto por defecto."""
    handle = request.app.state.prompt
    if handle is None:
        return {"source": "default", "name": None, "version": None, "tag": None}
    # versión 0 = MemTrace no respondió al arrancar y se usa el `default=` hasta que conteste
    return {"source": "registry" if handle.version > 0 else "default", "name": handle.name, "version": handle.version, "tag": handle.tag}


@router.get("/capabilities", response_model=list[CapabilityInfo])
async def list_capabilities(request: Request) -> list[CapabilityInfo]:
    return [
        CapabilityInfo(name=capability.name, description=capability.description)
        for capability in request.app.state.capabilities
    ]
