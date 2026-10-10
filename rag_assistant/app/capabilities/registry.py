"""Lista única de capabilities activas. Añadir una funcionalidad nueva = añadirla aquí."""

from app.capabilities.base import Capability
from app.capabilities.faq import faq_capability

ALL_CAPABILITIES: list[Capability] = [
    faq_capability,
]


def build_capabilities() -> list[Capability]:
    return list(ALL_CAPABILITIES)
