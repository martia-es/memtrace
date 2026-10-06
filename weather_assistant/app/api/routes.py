import uuid

from fastapi import APIRouter, HTTPException, Request
from memtrace import trace_step_context

from app.agents.deps import AssistantDeps
from app.api.schemas import CapabilityInfo, ChatRequest, ChatResponse
from app.guardrails.input import run_input_guardrail

router = APIRouter(prefix="/api")


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    state = request.app.state
    session_id = payload.session_id or str(uuid.uuid4())

    # Un solo span para el turno: el guardarraíl y el agente cuelgan de la misma traza (ADR-026).
    with trace_step_context("conversation_turn", step_type="chain"):
        verdict = run_input_guardrail(payload.message)
        if verdict.blocked:
            # el mensaje bloqueado no llega al agente ni se guarda en el historial
            return ChatResponse(session_id=session_id, reply=verdict.reply, blocked=True)

        history = await state.sessions.get_history(session_id)
        deps = AssistantDeps(weather=state.weather)
        result = await state.agent.run(payload.message, message_history=history, deps=deps)
        await state.sessions.save_history(session_id, result.all_messages())

    return ChatResponse(session_id=session_id, reply=result.output)


@router.delete("/sessions/{session_id}", status_code=204)
async def clear_session(session_id: str, request: Request) -> None:
    if not await request.app.state.sessions.clear(session_id):
        raise HTTPException(status_code=404, detail="Sesión no encontrada")


@router.get("/capabilities", response_model=list[CapabilityInfo])
async def list_capabilities(request: Request) -> list[CapabilityInfo]:
    return [
        CapabilityInfo(name=capability.name, description=capability.description)
        for capability in request.app.state.capabilities
    ]
