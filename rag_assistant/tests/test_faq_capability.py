"""`search_faqs` y la respuesta del chat con sus fuentes, sin LLM ni red."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai import models
from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.test import TestModel

from app.agents.assistant import build_assistant
from app.agents.deps import AssistantDeps
from app.api.routes import router
from app.capabilities.registry import build_capabilities
from app.knowledge.retriever import Bm25Retriever, load_entries
from app.sessions import SessionStore

models.ALLOW_MODEL_REQUESTS = False

RETRIEVER = Bm25Retriever(load_entries())


def tool_result(run) -> dict:
    return next(
        part.content for message in run.all_messages() for part in message.parts if isinstance(part, ToolReturnPart)
    )


async def test_search_returns_the_matching_faq():
    agent = build_assistant("test", "Iberia", build_capabilities())
    run = await agent.run(
        "equipaje de mano", model=TestModel(call_tools=["search_faqs"], custom_output_text="ok"), deps=AssistantDeps(RETRIEVER)
    )
    # TestModel rellena `query` con un texto de prueba: basta con comprobar la forma de la respuesta
    assert set(tool_result(run)) <= {"results", "note"}


async def test_no_results_tells_the_agent_to_say_it_does_not_know():
    from app.capabilities.faq import search_faqs

    class Ctx:
        deps = AssistantDeps(RETRIEVER)

    result = await search_faqs(Ctx(), "receta de paella con marisco")
    assert result["results"] == [] and "No hay información" in result["note"]


async def test_search_returns_text_with_ids():
    from app.capabilities.faq import search_faqs

    class Ctx:
        deps = AssistantDeps(RETRIEVER)

    result = await search_faqs(Ctx(), "peso del equipaje de mano", top_k=99)
    assert result["results"][0]["id"] == "equipaje-mano"
    assert "10 kg" in result["results"][0]["text"]
    assert len(result["results"]) <= 5


class ToolUsingAgent:
    """Hace la búsqueda real y devuelve un texto fijo: comprueba las fuentes del endpoint sin LLM."""

    async def run(self, message, message_history, deps):
        from app.capabilities.faq import search_faqs

        class Ctx:
            pass

        ctx = Ctx()
        ctx.deps = deps
        content = await search_faqs(ctx, message)

        class Result:
            output = "respuesta"

            def all_messages(self):
                return []

            def new_messages(self):
                from pydantic_ai.messages import ModelResponse

                from pydantic_ai.messages import ModelRequest

                return [ModelRequest(parts=[ToolReturnPart(tool_name="search_faqs", content=content, tool_call_id="1")])]

        return Result()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    app.state.agent = ToolUsingAgent()
    app.state.sessions = SessionStore()
    app.state.retriever = RETRIEVER
    app.state.capabilities = build_capabilities()
    return TestClient(app)


def test_chat_returns_the_consulted_faqs_as_sources(client):
    body = client.post("/api/chat", json={"message": "¿Cuánto pesa el equipaje de mano?"}).json()
    assert body["sources"][0] == {"id": "equipaje-mano", "title": "Equipaje de mano"}
    assert len({s["id"] for s in body["sources"]}) == len(body["sources"])


def test_chat_has_no_sources_when_nothing_matches(client):
    assert client.post("/api/chat", json={"message": "receta de paella"}).json()["sources"] == []


def test_capabilities_endpoint(client):
    assert [c["name"] for c in client.get("/api/capabilities").json()] == ["faq"]
