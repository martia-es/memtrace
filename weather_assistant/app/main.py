"""Punto de entrada: `uvicorn app.main:app --reload` desde `weather_assistant/`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from app.agents.assistant import build_assistant
from app.api.routes import router
from app.capabilities.registry import build_capabilities
from app.config import Settings
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
        app.state.agent = build_assistant(settings.model, capabilities)
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
