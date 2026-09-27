import sys
import types
import uuid

import pytest

pytest.importorskip("langchain_core")

import memtrace
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from memtrace.adapters.inbound.langchain import MemTraceCallbackHandler

from tests.conftest import by_name


def test_chat_model_usage_metadata_and_hierarchy(spans):
    h = MemTraceCallbackHandler()
    chain_id, llm_id, tool_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    # serialized=None (LangGraph) no debe romper; el nombre viene del kwarg `name`
    h.on_chain_start(
        None,
        {"q": "hi"},
        run_id=chain_id,
        name="agent",
        metadata={"thread_id": "t1"},
        tags=["a"],
    )
    h.on_chat_model_start(
        {"id": ["langchain", "ChatAnthropic"]},
        [[HumanMessage(content="hola")]],
        run_id=llm_id,
        parent_run_id=chain_id,
        metadata={
            "ls_provider": "anthropic",
            "ls_model_name": "claude-x",
            "ls_temperature": 0.1,
        },
    )
    msg = AIMessage(
        content="ey",
        id="msg_1",
        usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
        response_metadata={"model_name": "claude-x-2024", "stop_reason": "end_turn"},
    )
    h.on_llm_end(LLMResult(generations=[[ChatGeneration(message=msg)]]), run_id=llm_id)
    h.on_tool_start({"name": "search"}, "q", run_id=tool_id, parent_run_id=chain_id)
    h.on_tool_error(RuntimeError("x"), run_id=tool_id)
    h.on_chain_end({}, run_id=chain_id)

    chain = by_name(spans, "agent")
    llm = by_name(spans, "ChatAnthropic: claude-x")
    tool = by_name(spans, "search")
    assert llm.parent.span_id == chain.context.span_id
    assert llm.attributes["gen_ai.provider.name"] == "anthropic"
    assert llm.attributes["gen_ai.usage.input_tokens"] == 7
    assert llm.attributes["gen_ai.usage.total_tokens"] == 10
    assert llm.attributes["gen_ai.response.model"] == "claude-x-2024"
    assert llm.attributes["gen_ai.response.finish_reasons"] == ("end_turn",)
    assert llm.attributes["gen_ai.request.temperature"] == 0.1
    assert "gen_ai.input.messages" not in llm.attributes
    assert chain.attributes["gen_ai.conversation.id"] == "t1"
    assert tool.status.status_code.name == "ERROR"


def test_detects_langgraph_from_metadata(spans):
    h = MemTraceCallbackHandler()
    rid = uuid.uuid4()
    h.on_chain_start(
        None, {}, run_id=rid, name="agent",
        metadata={"thread_id": "t1", "langgraph_node": "call_model", "langgraph_step": 2},
    )
    h.on_chain_end({}, run_id=rid)
    assert by_name(spans, "agent").attributes["memtrace.framework"] == "langgraph"


def test_defaults_to_langchain_without_langgraph_metadata(spans):
    h = MemTraceCallbackHandler()
    rid = uuid.uuid4()
    h.on_chain_start(None, {}, run_id=rid, name="chain", metadata={"thread_id": "t1"})
    h.on_chain_end({}, run_id=rid)
    assert by_name(spans, "chain").attributes["memtrace.framework"] == "langchain"


def test_openai_style_llm_output_tokens(spans):
    h = MemTraceCallbackHandler()
    rid = uuid.uuid4()
    h.on_llm_start(
        {"name": "OpenAI"},
        ["p"],
        run_id=rid,
        invocation_params={"model_name": "gpt-4o", "_type": "openai"},
    )
    h.on_llm_end(
        LLMResult(
            generations=[[]],
            llm_output={
                "token_usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 2,
                    "total_tokens": 6,
                }
            },
        ),
        run_id=rid,
    )
    a = by_name(spans, "OpenAI: gpt-4o").attributes
    assert (a["gen_ai.usage.input_tokens"], a["gen_ai.usage.output_tokens"]) == (4, 2)


def test_langchain_inside_trace_step_is_child(spans):
    h = MemTraceCallbackHandler()
    with memtrace.trace_step_context("outer"):
        rid = uuid.uuid4()
        h.on_chain_start({"name": "c"}, {}, run_id=rid, parent_run_id=None)
        h.on_chain_end({}, run_id=rid)
    assert by_name(spans, "c").parent.span_id == by_name(spans, "outer").context.span_id


def test_enable_langchain_instrumentation_accepts_current_class_name(monkeypatch):
    calls = []

    class FakeInstrumentor:
        def instrument(self):
            calls.append("instrumented")

    fake_module = types.SimpleNamespace(LangchainInstrumentor=FakeInstrumentor)
    monkeypatch.setitem(
        sys.modules, "opentelemetry.instrumentation.langchain", fake_module
    )

    memtrace.enable_langchain_instrumentation()

    assert calls == ["instrumented"]
