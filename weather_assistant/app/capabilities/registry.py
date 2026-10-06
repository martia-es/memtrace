"""Lista única de capabilities activas. Añadir una funcionalidad nueva = añadirla aquí."""

from app.capabilities.base import Capability
from app.capabilities.weather import weather_capability

ALL_CAPABILITIES: list[Capability] = [
    weather_capability,
]


def build_capabilities(air_quality_mcp_url: str | None) -> list[Capability]:
    """Las del asistente en ejecución: las de `ALL_CAPABILITIES` más las que dependen de un servidor MCP."""
    from app.capabilities.air_quality import air_quality_capability
    from app.capabilities.uv_pollen import uv_pollen_capability

    return [*ALL_CAPABILITIES, uv_pollen_capability, air_quality_capability(air_quality_mcp_url)]
