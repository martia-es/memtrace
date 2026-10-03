"""Lista única de capabilities activas. Añadir una funcionalidad nueva = añadirla aquí."""

from app.capabilities.base import Capability
from app.capabilities.weather import weather_capability

ALL_CAPABILITIES: list[Capability] = [
    weather_capability,
]
