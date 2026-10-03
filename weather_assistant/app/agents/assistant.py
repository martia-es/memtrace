"""Construye el agente a partir de las capabilities registradas."""

from pydantic_ai import Agent

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability

BASE_INSTRUCTIONS = (
    "Eres un asistente virtual. Solo puedes usar las herramientas que tienes disponibles. "
    "Si te piden algo que no puedes hacer con ellas, dilo con claridad."
)


def build_assistant(model: str, capabilities: list[Capability]) -> Agent[AssistantDeps, str]:
    instructions = [BASE_INSTRUCTIONS]
    instructions += [capability.instructions for capability in capabilities]
    tools = [tool for capability in capabilities for tool in capability.tools]

    return Agent(
        model,
        deps_type=AssistantDeps,
        output_type=str,
        instructions="\n\n".join(instructions),
        tools=tools,
    )
