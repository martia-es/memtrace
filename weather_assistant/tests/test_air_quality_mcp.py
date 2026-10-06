"""Capability servida por MCP: el servidor responde por MCP y MemTrace nombra el servidor en el span de la tool."""

import functools

import httpx
import memtrace
import pytest
from fastmcp import Client
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai import models
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models.test import TestModel

from app.agents.assistant import build_assistant
from app.capabilities.air_quality import MCP_SERVER_ID, air_quality_capability
from app.capabilities.base import Capability
from app.capabilities.registry import ALL_CAPABILITIES, build_capabilities
from app.mcp_servers import air_quality as server
from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation

models.ALLOW_MODEL_REQUESTS = False

GEOCODING = {"results": [{"name": "Bilbao", "country": "España", "latitude": 43.26, "longitude": -2.93}]}
AIR = {"current": {"time": "2026-10-06T12:00", "european_aqi": 35, "pm2_5": 8.1, "pm10": 14.0, "ozone": 60.0, "nitrogen_dioxide": 12.0}}


@pytest.fixture
def mock_open_meteo(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=GEOCODING if "geocoding" in request.url.host else AIR)

    real = httpx.AsyncClient
    monkeypatch.setattr(server.httpx, "AsyncClient", functools.partial(real, transport=httpx.MockTransport(handler)))


@pytest.fixture
def spans():
    memtrace.shutdown()
    exporter = InMemorySpanExporter()
    memtrace.init_tracer(service_name="weather-test", span_exporter=exporter)
    enable_pydantic_ai_instrumentation()
    yield exporter
    memtrace.shutdown()


def test_air_quality_levels():
    assert [server.describe_eaqi(v) for v in (10, 35, 55, 75, 95, 120, None)] == [
        "buena", "aceptable", "moderada", "mala", "muy mala", "extremadamente mala", "desconocida",
    ]


async def test_server_tool_returns_structured_air_quality(mock_open_meteo):
    async with Client(server.mcp) as client:
        result = await client.call_tool("get_air_quality", {"location": "Bilbao"})

    assert result.data["location"] == "Bilbao"
    assert result.data["european_aqi"] == 35
    assert result.data["level"] == "aceptable"


def test_capability_is_served_by_mcp_not_by_local_functions():
    capability = air_quality_capability()
    assert capability.tools == [] and len(capability.toolsets) == 1
    assert capability.toolsets[0].id == MCP_SERVER_ID


def test_running_assistant_has_the_capability_but_the_eval_set_does_not():
    assert "air_quality" in [c.name for c in build_capabilities(None)]
    assert "air_quality" not in [c.name for c in ALL_CAPABILITIES]


async def test_tool_span_names_the_mcp_server(mock_open_meteo, spans):
    capability = Capability(
        name="air_quality", description="", instructions="",
        toolsets=[MCPToolset(server.mcp, id=MCP_SERVER_ID)],
    )
    agent = build_assistant("test", [capability])

    with agent.override(model=TestModel(call_tools=["get_air_quality"])):
        result = await agent.run("¿Qué calidad del aire hay en Bilbao?")

    assert "aceptable" in result.output
    tool_spans = [s for s in spans.get_finished_spans() if s.attributes.get("gen_ai.operation.name") == "execute_tool"]
    assert [s.attributes["gen_ai.tool.name"] for s in tool_spans] == ["get_air_quality"]
    assert tool_spans[0].attributes["memtrace.mcp_server"] == MCP_SERVER_ID
