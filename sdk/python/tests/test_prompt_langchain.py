"""`prompt_middleware`: a registry prompt as the system prompt of a LangChain `create_agent` agent (ADR-068)."""
import sys
from dataclasses import dataclass
from typing import List

import pytest

pytest.importorskip("langchain.agents")  # LangChain 1.x needs Python 3.10+

from langchain.agents import create_agent  # noqa: E402
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter  # noqa: E402

import memtrace  # noqa: E402
from memtrace.application.prompt_ports import Fetched  # noqa: E402
from memtrace.application.prompt_registry import PromptRegistry  # noqa: E402
from memtrace.dependency_container import _annotate_current_span  # noqa: E402
from memtrace.domain.prompt import MissingVariableError, PromptVersion  # noqa: E402
from memtrace.langchain import prompt_middleware  # noqa: E402


class Moving:
    """A registry whose tag the test moves: version n says `texto n para {{ciudad}}`."""

    def __init__(self, name: str = "weather-system") -> None:
        self.n = 1
        self.name = name

    def fetch(self, name, tag, version, etag):
        return Fetched(PromptVersion(name, self.n, f"texto {self.n} para {{{{ciudad}}}}", ("ciudad",)), None)


class Recorder(GenericFakeChatModel):
    """A chat model that remembers the system message of every call it receives."""

    seen: List[str] = []

    def _generate(self, messages, *args, **kwargs):
        self.seen.append(messages[0].content if messages and messages[0].type == "system" else "")
        return super()._generate(messages, *args, **kwargs)


def model() -> Recorder:
    return Recorder(messages=iter(AIMessage(content=f"respuesta {i}") for i in range(20)), seen=[])


@pytest.fixture
def prompt():
    source = Moving()
    registry = PromptRegistry(source, annotate=_annotate_current_span, environment="dev")
    yield source, registry.get("weather-system")
    registry.shutdown()


def ask(agent, **kwargs):
    return agent.invoke({"messages": [("user", "hola")]}, **kwargs)


def test_the_agent_uses_the_version_in_force_on_every_call_without_being_rebuilt(prompt):
    source, handle = prompt
    llm = model()
    agent = create_agent(llm, [], middleware=[prompt_middleware(handle, ciudad="Sevilla")])  # built once, like in a lifespan
    ask(agent)
    source.n = 2
    assert handle.refresh() is True
    ask(agent)
    assert llm.seen == ["texto 1 para Sevilla", "texto 2 para Sevilla"]


@pytest.mark.asyncio
async def test_it_works_in_async_agents_too(prompt):
    source, handle = prompt
    llm = model()
    agent = create_agent(llm, [], middleware=[prompt_middleware(handle, ciudad="Sevilla")])
    await agent.ainvoke({"messages": [("user", "hola")]})
    source.n = 3
    handle.refresh()
    await agent.ainvoke({"messages": [("user", "hola")]})
    assert llm.seen == ["texto 1 para Sevilla", "texto 3 para Sevilla"]


def test_a_variable_that_is_a_function_receives_the_request_on_every_call(prompt):
    _, handle = prompt

    @dataclass
    class Context:
        city: str

    llm = model()
    agent = create_agent(llm, [], middleware=[prompt_middleware(handle, ciudad=lambda request: request.runtime.context.city)], context_schema=Context)
    ask(agent, context=Context(city="Sevilla"))
    ask(agent, context=Context(city="Bilbao"))
    assert llm.seen == ["texto 1 para Sevilla", "texto 1 para Bilbao"]


def test_a_missing_variable_fails_loudly_instead_of_sending_a_half_filled_prompt(prompt):
    _, handle = prompt
    agent = create_agent(model(), [], middleware=[prompt_middleware(handle)])
    with pytest.raises(MissingVariableError, match="ciudad"):
        ask(agent)


def test_the_trace_is_linked_to_the_version_the_agent_used():
    memtrace.shutdown()
    exporter = InMemorySpanExporter()
    memtrace.init_tracer(service_name="lc-prompt", span_exporter=exporter)
    registry = PromptRegistry(Moving(), annotate=_annotate_current_span, environment="dev")
    try:
        agent = create_agent(model(), [], middleware=[prompt_middleware(registry.get("weather-system"), ciudad="Sevilla")])
        with memtrace.trace_step_context("turn", step_type="agent"):
            ask(agent)
        memtrace.flush()
        spans = exporter.get_finished_spans()
        (turn,) = [s for s in spans if s.name == "turn"]
        # the span being run when the prompt is compiled gets it: "turn", or a child span if LangChain's
        # auto-instrumentation (enabled process-wide by other tests) opened one around the model call
        stamped = [s for s in spans if s.attributes.get("memtrace.prompt.name") == "weather-system"]
        assert stamped and all(s.attributes["memtrace.prompt.version"] == 1 for s in stamped)
        assert all(s.context.trace_id == turn.context.trace_id for s in stamped)
    finally:
        registry.shutdown()
        memtrace.shutdown()


def test_two_prompts_can_live_in_the_same_agent(prompt):
    _, handle = prompt
    other = PromptRegistry(Moving("tone"), environment="dev")
    try:
        first = prompt_middleware(handle, ciudad="x")
        second = prompt_middleware(other.get("tone"), ciudad="x")
        assert first.name != second.name  # LangChain rejects two middlewares with the same name
        create_agent(model(), [], middleware=[first, second])
    finally:
        other.shutdown()


def test_without_langchain_1_it_explains_what_to_install(prompt, monkeypatch):
    _, handle = prompt
    monkeypatch.setitem(sys.modules, "langchain.agents.middleware", None)
    with pytest.raises(ImportError, match="pip install"):
        prompt_middleware(handle)
