"""Punto de entrada: `uvicorn app.main:app --reload` desde `weather_assistant/`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse

from app.agents.assistant import build_assistant
from app.api.routes import router
from app.capabilities.registry import ALL_CAPABILITIES
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
        app.state.capabilities = ALL_CAPABILITIES
        app.state.agent = build_assistant(settings.model, ALL_CAPABILITIES)
        app.state.weather = WeatherService(
            client,
            geocoding_url=settings.open_meteo_geocoding_url,
            forecast_url=settings.open_meteo_forecast_url,
        )
        app.state.sessions = SessionStore()
        yield


app = FastAPI(title="Weather assistant", lifespan=lifespan)
app.include_router(router)


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
