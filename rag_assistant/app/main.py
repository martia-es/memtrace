"""Punto de entrada: `uvicorn app.main:app --reload` desde `rag_assistant/`."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from memtrace.prompts import PromptOverrideMiddleware

from app.agents.assistant import build_assistant, compose_instructions
from app.api.routes import router
from app.capabilities.registry import build_capabilities
from app.config import Settings
from app.prompt_registry import load_prompt
from app.knowledge.retriever import Bm25Retriever, load_entries
from app.sessions import SessionStore
from app.tracing import setup_tracing

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    setup_tracing()
    capabilities = build_capabilities()
    app.state.capabilities = capabilities
    default_instructions = compose_instructions(settings.company, capabilities)
    # lee una vez, en el lifespan; el handle sigue solo el tag que se mueva en MemTrace
    app.state.prompt = await asyncio.to_thread(load_prompt, default_instructions)
    app.state.retriever = Bm25Retriever(load_entries(settings.knowledge_path))
    app.state.sessions = SessionStore()
    # el último: /health responde 200 en cuanto existe el agente, y para entonces todo lo demás ya está listo
    app.state.agent = build_assistant(
        settings.model, settings.company, capabilities, app.state.prompt.as_callable() if app.state.prompt else None
    )
    yield


app = FastAPI(title="RAG assistant", lifespan=lifespan)
app.include_router(router)
# MemTrace "Try it": con MEMTRACE_ALLOW_PROMPT_OVERRIDE=true acepta el token efímero de una versión a probar (solo en no producción)
app.add_middleware(PromptOverrideMiddleware)


@app.get("/health", include_in_schema=False)
async def health(request: Request) -> JSONResponse:
    """Abierto y sin credenciales: lo sondea el catálogo de asistentes de MemTrace (ADR-053).

    200 cuando el agente está construido; 503 mientras arranca (el lifespan aún no ha terminado).
    """
    ready = hasattr(request.app.state, "agent")
    return JSONResponse({"status": "ok" if ready else "starting"}, status_code=200 if ready else 503)


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
