"""MCP tool spans carry the name of their server (ADR-053 §8)."""
import asyncio
import sys
import types

import pytest

import memtrace
from memtrace.adapters.inbound.pydantic_ai import mcp as mcp_adapter
from tests.conftest import by_name


class _Info:
    def __init__(self, name):
        self.name = name


class _Toolset:
    id = None

    def __init__(self, id=None, server_name=None):
        self.id = id
        self._server_name = server_name

    @property
    def server_info(self):
        if self._server_name is None:
            raise AttributeError("not initialized")
        return _Info(self._server_name)

    async def call_tool(self, name, args):
        return f"{name}:{args}"


def test_server_name_prefers_the_id_the_user_gave():
    assert mcp_adapter.mcp_server_name(_Toolset(id="weather-mcp", server_name="srv")) == "weather-mcp"


def test_server_name_falls_back_to_what_the_server_announced():
    assert mcp_adapter.mcp_server_name(_Toolset(server_name="srv")) == "srv"


def test_server_name_is_none_when_unknown():
    assert mcp_adapter.mcp_server_name(_Toolset()) is None


def test_wrapped_call_tool_stamps_the_current_span_and_returns_the_result(spans):
    wrapped = mcp_adapter._wrap(_Toolset.call_tool)

    async def run():
        with memtrace.trace_step_context("get_forecast", step_type="tool"):
            return await wrapped(_Toolset(id="weather-mcp"), "get_forecast", {"city": "Bilbao"})

    assert asyncio.run(run()) == "get_forecast:{'city': 'Bilbao'}"
    assert by_name(spans, "get_forecast").attributes["memtrace.mcp_server"] == "weather-mcp"


def test_local_tool_span_is_not_stamped_when_the_server_is_unknown(spans):
    wrapped = mcp_adapter._wrap(_Toolset.call_tool)

    async def run():
        with memtrace.trace_step_context("local", step_type="tool"):
            await wrapped(_Toolset(), "local", {})

    asyncio.run(run())
    assert "memtrace.mcp_server" not in by_name(spans, "local").attributes


def test_instrumenting_is_idempotent_and_covers_both_class_names(monkeypatch):
    pydantic_ai = pytest.importorskip("pydantic_ai")
    fake = types.ModuleType("pydantic_ai.mcp")
    fake.MCPServer = type("MCPServer", (_Toolset,), {})
    fake.MCPToolset = type("MCPToolset", (_Toolset,), {})
    monkeypatch.setitem(sys.modules, "pydantic_ai.mcp", fake)
    monkeypatch.setattr(pydantic_ai, "mcp", fake, raising=False)

    mcp_adapter.instrument_mcp_toolsets()
    first = (fake.MCPServer.call_tool, fake.MCPToolset.call_tool)
    mcp_adapter.instrument_mcp_toolsets()

    assert (fake.MCPServer.call_tool, fake.MCPToolset.call_tool) == first
    assert all(getattr(f, "_memtrace_mcp_patched", False) for f in first)


def test_instrumenting_without_mcp_installed_does_nothing(monkeypatch):
    monkeypatch.setitem(sys.modules, "pydantic_ai.mcp", None)  # makes the import raise ImportError
    mcp_adapter.instrument_mcp_toolsets()
