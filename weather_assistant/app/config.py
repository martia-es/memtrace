"""Configuración del asistente, leída de variables de entorno (o del `.env` del repo)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Carga el .env de la raíz del repo (si existe) sin sobrescribir variables ya definidas.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    model: str
    open_meteo_geocoding_url: str
    open_meteo_forecast_url: str
    http_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model=os.getenv("WEATHER_ASSISTANT_MODEL", "google:gemini-2.5-flash"),
            open_meteo_geocoding_url=os.getenv(
                "OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"
            ),
            open_meteo_forecast_url=os.getenv(
                "OPEN_METEO_FORECAST_URL", "https://api.open-meteo.com/v1/forecast"
            ),
            http_timeout_seconds=float(os.getenv("WEATHER_ASSISTANT_HTTP_TIMEOUT", "10")),
        )
