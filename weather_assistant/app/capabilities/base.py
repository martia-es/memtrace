"""Contrato de una capability: un bloque de funcionalidad que el agente puede usar.

Para ampliar el asistente, se crea un módulo nuevo en `app/capabilities/` que exporta
una `Capability` y se añade a `app/capabilities/registry.py`. El agente no cambia.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Capability:
    name: str
    description: str
    # Instrucciones que se añaden al system prompt del agente para esta capability.
    instructions: str
    # Funciones con `RunContext` como primer argumento (Pydantic AI las convierte en tools).
    tools: list[Callable[..., Any]] = field(default_factory=list)
