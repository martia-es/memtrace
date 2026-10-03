"""Dependencias inyectadas en cada ejecución del agente (`RunContext.deps`)."""

from dataclasses import dataclass

from app.services.weather_service import WeatherService


@dataclass
class AssistantDeps:
    weather: WeatherService
