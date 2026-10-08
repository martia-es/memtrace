"""The two ways of giving a prompt handle to a framework without freezing its version (ADR-068)."""
import pytest

from memtrace.application.prompt_ports import Fetched
from memtrace.application.prompt_registry import PromptRegistry
from memtrace.domain.prompt import PromptVersion


class Moving:
    """A registry whose tag the test moves: version n has the text `texto n`."""

    def __init__(self) -> None:
        self.n = 1

    def fetch(self, name, tag, version, etag):
        return Fetched(PromptVersion(name, self.n, f"texto {self.n} para {{{{ciudad}}}}", ("ciudad",)), None)


@pytest.fixture
def moving():
    source = Moving()
    registry = PromptRegistry(source, environment="dev")
    handle = registry.get("weather-system")
    yield source, handle
    registry.shutdown()


def test_pydantic_ai_evaluates_the_callable_on_every_run(moving):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    source, handle = moving
    agent = Agent(TestModel(), instructions=handle.as_callable(ciudad="Sevilla"))  # built once, like in a lifespan

    def instructions_of_last_run():
        return [m.instructions for m in agent.run_sync("hola").all_messages() if getattr(m, "instructions", None)][0]

    assert instructions_of_last_run() == "texto 1 para Sevilla"
    source.n = 2
    assert handle.refresh() is True
    assert instructions_of_last_run() == "texto 2 para Sevilla"  # the agent was not rebuilt


def test_langchain_runnable_resolves_the_prompt_when_it_runs(moving):
    pytest.importorskip("langchain_core")
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_core.runnables import RunnableLambda

    source, handle = moving
    seen = []

    def model(messages):
        seen.append(messages[0].content)
        return iter([AIMessage(content="ok")])

    chain = RunnableLambda(lambda question: [SystemMessage(handle.compile(ciudad="Sevilla")), HumanMessage(question)]) | RunnableLambda(
        lambda messages: GenericFakeChatModel(messages=model(messages)).invoke(messages)
    )
    chain.invoke("hola")
    source.n = 2
    handle.refresh()
    chain.invoke("hola")
    assert seen == ["texto 1 para Sevilla", "texto 2 para Sevilla"]
