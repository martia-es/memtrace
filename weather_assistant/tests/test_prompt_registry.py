"""El prompt del asistente puede venir del registro de MemTrace sin cambiar cómo se construye el agente."""

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.agents.assistant import build_assistant, compose_instructions
from app.agents.deps import AssistantDeps
from app.api.routes import router
from app.capabilities.registry import build_capabilities
from app.prompt_registry import load_prompt


def instructions_of(result) -> str:
    return next(m.instructions for m in result.all_messages() if getattr(m, "instructions", None))


async def test_default_instructions_when_there_is_no_registry_prompt():
    capabilities = build_capabilities(None)
    agent = build_assistant("test", capabilities)
    result = await agent.run("hola", model=TestModel(call_tools=[]), deps=AssistantDeps(weather=None))
    assert instructions_of(result) == compose_instructions(capabilities)


async def test_instructions_function_is_evaluated_on_every_run():
    # lo que hace PromptHandle.as_callable(): el texto se resuelve en cada ejecución, no al construir el agente
    current = {"text": "versión 1"}
    agent = build_assistant("test", build_capabilities(None), lambda *_: current["text"])
    first = await agent.run("hola", model=TestModel(call_tools=[]), deps=AssistantDeps(weather=None))
    current["text"] = "versión 2"
    second = await agent.run("hola", model=TestModel(call_tools=[]), deps=AssistantDeps(weather=None))
    assert (instructions_of(first), instructions_of(second)) == ("versión 1", "versión 2")


def test_registry_is_off_without_memtrace_api_url(monkeypatch):
    monkeypatch.delenv("MEMTRACE_API_URL", raising=False)
    assert load_prompt("texto") is None


def client_with(prompt) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.prompt = prompt
    return TestClient(app)


def test_prompt_endpoint_says_it_uses_the_default_text():
    assert client_with(None).get("/api/prompt").json() == {"source": "default", "name": None, "version": None, "tag": None}


def test_prompt_endpoint_reports_the_registry_version():
    handle = SimpleNamespace(name="weather-system", version=3, tag="dev")
    assert client_with(handle).get("/api/prompt").json() == {"source": "registry", "name": "weather-system", "version": 3, "tag": "dev"}


def test_prompt_endpoint_says_default_while_memtrace_was_unreachable_at_start():
    handle = SimpleNamespace(name="weather-system", version=0, tag="dev")
    assert client_with(handle).get("/api/prompt").json()["source"] == "default"


def test_follows_dev_when_no_environment_is_set(monkeypatch):
    seen = {}
    monkeypatch.setenv("MEMTRACE_API_URL", "http://x")
    monkeypatch.delenv("MEMTRACE_ENVIRONMENT", raising=False)
    monkeypatch.setattr("app.prompt_registry.prompts.get", lambda name, **kw: seen.update(name=name, **kw) or "handle")
    assert load_prompt("texto") == "handle"
    assert seen["tag"] == "dev"


def test_follows_the_environment_tag_when_it_is_set(monkeypatch):
    seen = {}
    monkeypatch.setenv("MEMTRACE_API_URL", "http://x")
    monkeypatch.setenv("MEMTRACE_ENVIRONMENT", "pro")
    monkeypatch.setattr("app.prompt_registry.prompts.get", lambda name, **kw: seen.update(kw) or "handle")
    load_prompt("texto")
    assert seen["tag"] is None
