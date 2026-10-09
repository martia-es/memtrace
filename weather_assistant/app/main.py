"""Punto de entrada: `uvicorn app.main:app --reload` desde `weather_assistant/`."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from memtrace.prompts import PromptOverrideMiddleware

from app.agents.assistant import build_assistant, compose_instructions
from app.api.routes import router
from app.capabilities.registry import build_capabilities
from app.config import Settings
from app.prompt_registry import load_prompt
from app.services.weather_service import WeatherService
from app.sessions import SessionStore
from app.tracing import setup_tracing

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    setup_tracing()
    async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
        capabilities = build_capabilities(settings.air_quality_mcp_url)
        app.state.capabilities = capabilities
        default_instructions = compose_instructions(capabilities)
        # lee una vez, en el lifespan; el handle sigue solo el tag que se mueva en MemTrace
        app.state.prompt = await asyncio.to_thread(load_prompt, default_instructions)
        app.state.agent = build_assistant(
            settings.model, capabilities, app.state.prompt.as_callable() if app.state.prompt else None
        )
        app.state.weather = WeatherService(
            client,
            geocoding_url=settings.open_meteo_geocoding_url,
            forecast_url=settings.open_meteo_forecast_url,
            air_quality_url=settings.open_meteo_air_quality_url,
        )
        app.state.sessions = SessionStore()
        async with app.state.agent:  # mantiene abiertos los servidores MCP mientras el proceso vive
            yield


app = FastAPI(title="Weather assistant", lifespan=lifespan)
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
