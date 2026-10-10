"""The OpenAI Agents SDK tracing processor, driven by the SDK's own trace/span helpers and a real `Runner` run."""
import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("agents")
from agents import Agent, Model, ModelResponse, Runner, Usage, function_tool, set_trace_processors, trace  # noqa: E402
from agents.tracing import function_span, generation_span, guardrail_span, handoff_span, response_span  # noqa: E402
from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText  # noqa: E402

from memtrace.openai_agents import MemTraceTracingProcessor  # noqa: E402


@pytest.fixture
def traced(spans_capture):
    set_trace_processors([MemTraceTracingProcessor()])
    yield spans_capture
    set_trace_processors([])


def _finished(exporter):
    return {s.name: s for s in exporter.get_finished_spans() if s.instrumentation_scope.name == "memtrace"}


def _parent_name(span, spans):
    by_id = {s.context.span_id: s.name for s in spans.values()}
    return by_id.get(span.parent.span_id) if span.parent else None


class _FakeModel(Model):
    """First call asks for the tool, the second answers; it makes no network call (and so no model spans)."""

    def __init__(self):
        self.calls = 0

    async def get_response(self, *args, **kwargs):
        self.calls += 1
        if self.calls == 1:
            output = [ResponseFunctionToolCall(id="f1", call_id="c1", type="function_call", name="weather", arguments='{"city":"Madrid"}')]
        else:
            output = [ResponseOutputMessage(id="m1", type="message", role="assistant", status="completed",
                                            content=[ResponseOutputText(type="output_text", text="Sunny", annotations=[])])]
        return ModelResponse(output=output, usage=Usage(requests=1, input_tokens=10, output_tokens=4, total_tokens=14), response_id=f"r{self.calls}")

    def stream_response(self, *args, **kwargs):
        raise NotImplementedError


@function_tool
def weather(city: str) -> str:
    return f"sunny in {city}"


def test_a_real_run_becomes_workflow_agent_and_tool_steps(traced):
    agent = Agent(name="Weather agent", instructions="x", tools=[weather], model=_FakeModel())

    async def run():
        with trace("Weather workflow", group_id="conv-7"):
            return await Runner.run(agent, "weather?")

    assert asyncio.run(run()).final_output == "Sunny"

    spans = _finished(traced)
    assert _parent_name(spans["Weather workflow"], spans) is None
    assert _parent_name(spans["Weather agent"], spans) is not None
    tool = spans["weather"]
    assert tool.attributes["memtrace.step_type"] == "tool" and tool.attributes["gen_ai.tool.name"] == "weather"
    assert "Madrid" in tool.attributes["gen_ai.tool.call.arguments"] and "sunny in Madrid" in tool.attributes["gen_ai.tool.call.result"]
    for span in spans.values():  # the trace's group_id is the conversation of every span
        assert span.attributes["memtrace.framework"] == "openai-agents"
        assert span.attributes["gen_ai.conversation.id"] == "conv-7"


def test_a_generation_span_carries_the_genai_attributes(traced):
    with trace("wf"):
        with generation_span(input=[{"role": "user", "content": "hi"}], output=[{"role": "assistant", "content": "hello"}],
                             model="gpt-x", model_config={"temperature": 0.3}, usage={"input_tokens": 7, "output_tokens": 3}):
            pass
    llm = _finished(traced)["openai: gpt-x"]
    assert llm.attributes["memtrace.step_type"] == "llm"
    assert llm.attributes["gen_ai.provider.name"] == "openai"
    assert llm.attributes["gen_ai.request.model"] == "gpt-x"
    assert (llm.attributes["gen_ai.usage.input_tokens"], llm.attributes["gen_ai.usage.output_tokens"], llm.attributes["gen_ai.usage.total_tokens"]) == (7, 3, 10)
    assert llm.attributes["gen_ai.request.temperature"] == 0.3
    assert '"hello"' in llm.attributes["gen_ai.output.messages"]


def test_a_response_span_reads_the_response_object(traced):
    response = SimpleNamespace(
        model="gpt-x-2025", id="resp_1", temperature=None, top_p=None, usage=SimpleNamespace(input_tokens=11, output_tokens=5),
        output=[ResponseOutputMessage(id="m1", type="message", role="assistant", status="completed",
                                      content=[ResponseOutputText(type="output_text", text="Sunny", annotations=[])])])
    with trace("wf"):
        with response_span(response=response):
            pass
    llm = _finished(traced)["openai: gpt-x-2025"]
    assert llm.attributes["gen_ai.response.id"] == "resp_1"
    assert (llm.attributes["gen_ai.usage.input_tokens"], llm.attributes["gen_ai.usage.output_tokens"]) == (11, 5)
    assert "Sunny" in llm.attributes["gen_ai.output.messages"]


def test_content_is_not_recorded_by_default(spans):
    set_trace_processors([MemTraceTracingProcessor()])
    try:
        with trace("wf"):
            with generation_span(input=[{"role": "user", "content": "secret question"}], model="gpt-x", usage={"input_tokens": 1, "output_tokens": 1}):
                pass
    finally:
        set_trace_processors([])
    llm = _finished(spans)["openai: gpt-x"]
    assert "gen_ai.input.messages" not in llm.attributes and llm.attributes["gen_ai.usage.input_tokens"] == 1


def test_handoffs_guardrails_and_mcp_tools(traced):
    with trace("wf"):
        with handoff_span(from_agent="triage", to_agent="billing"):
            pass
        with guardrail_span(name="no-pii", triggered=True):
            pass
        with function_span(name="search", input="q", output="r") as span:
            span.span_data.mcp_data = {"server": "docs-mcp"}
    spans = _finished(traced)
    assert spans["handoff: triage -> billing"].attributes["memtrace.step_type"] == "chain"
    assert '"triggered": true' in spans["guardrail: no-pii"].attributes["memtrace.metadata"]
    assert spans["search"].attributes["memtrace.mcp_server"] == "docs-mcp"


def test_a_failed_span_ends_with_error_status(traced):
    with trace("wf"):
        with function_span(name="boom") as span:
            span.set_error({"message": "tool exploded", "data": None})
    assert _finished(traced)["boom"].status.status_code.name == "ERROR"


def test_enable_registers_one_processor_even_if_called_twice(spans, monkeypatch):
    from agents.tracing import get_trace_provider

    import memtrace
    from memtrace.adapters.inbound.openai_agents import auto

    monkeypatch.setattr(auto, "_installed", None)
    set_trace_processors([])
    try:
        memtrace.enable_openai_agents_instrumentation(keep_openai_export=False)
        memtrace.enable_openai_agents_instrumentation(keep_openai_export=False)
        mine = [p for p in get_trace_provider()._multi_processor._processors if isinstance(p, MemTraceTracingProcessor)]
        assert len(mine) == 1
    finally:
        set_trace_processors([])
