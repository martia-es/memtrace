"""Construye el agente a partir de las capabilities registradas."""

from collections.abc import Callable

from pydantic_ai import Agent

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability


def base_instructions(company: str) -> str:
    return (
        f"Eres el asistente virtual de preguntas frecuentes de {company}. Solo respondes sobre {company} y sus servicios, "
        "y solo con la información que obtienes de tus herramientas. Si te piden otra cosa, dilo con claridad."
    )


def compose_instructions(company: str, capabilities: list[Capability]) -> str:
    """El texto por defecto del prompt: el base más lo que aporta cada capability."""
    return "\n\n".join([base_instructions(company), *(capability.instructions for capability in capabilities)])


def build_assistant(
    model: str,
    company: str,
    capabilities: list[Capability],
    instructions: str | Callable[..., str] | None = None,
) -> Agent[AssistantDeps, str]:
    """`instructions` puede ser una función (p. ej. `PromptHandle.as_callable()`): Pydantic AI la evalúa en cada ejecución,
    así que mover un tag en MemTrace cambia el prompt del agente sin reiniciarlo."""
    return Agent(
        model,
        deps_type=AssistantDeps,
        output_type=str,
        instructions=instructions if instructions is not None else compose_instructions(company, capabilities),
        tools=[tool for capability in capabilities for tool in capability.tools],
        toolsets=[toolset for capability in capabilities for toolset in capability.toolsets] or None,
    )
