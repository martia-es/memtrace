"""Construye el agente a partir de las capabilities registradas."""

from collections.abc import Callable

from pydantic_ai import Agent

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability

BASE_INSTRUCTIONS = (
    "Eres un asistente virtual. Solo puedes usar las herramientas que tienes disponibles. "
    "Si te piden algo que no puedes hacer con ellas, dilo con claridad."
)


def compose_instructions(capabilities: list[Capability]) -> str:
    """El texto por defecto del prompt: el base más lo que aporta cada capability."""
    return "\n\n".join([BASE_INSTRUCTIONS, *(capability.instructions for capability in capabilities)])


def build_assistant(
    model: str,
    capabilities: list[Capability],
    instructions: str | Callable[..., str] | None = None,
) -> Agent[AssistantDeps, str]:
    """`instructions` puede ser una función (p. ej. `PromptHandle.as_callable()`): Pydantic AI la evalúa en cada ejecución,
    así que mover un tag en MemTrace cambia el prompt del agente sin reiniciarlo."""
    tools = [tool for capability in capabilities for tool in capability.tools]
    toolsets = [toolset for capability in capabilities for toolset in capability.toolsets]

    return Agent(
        model,
        deps_type=AssistantDeps,
        output_type=str,
        instructions=instructions if instructions is not None else compose_instructions(capabilities),
        tools=tools,
        toolsets=toolsets or None,
    )
