import asyncio
import time
import uuid

import pytest
from opentelemetry.trace import StatusCode

import memtrace
from memtrace.dependency_container import get_service
from tests.conftest import by_name


def test_nested_steps_share_trace_and_link_parent(spans):
    @memtrace.trace_step(name="inner", step_type="tool")
    def inner():
        return 1

    @memtrace.trace_step(name="outer", step_type="agent")
    def outer():
        return inner()

    outer()
    o, i = by_name(spans, "outer"), by_name(spans, "inner")
    assert i.context.trace_id == o.context.trace_id
    assert i.parent.span_id == o.context.span_id
    assert o.parent is None
    assert i.attributes["memtrace.step_type"] == "tool"
    assert i.attributes["gen_ai.operation.name"] == "execute_tool"
    assert i.attributes["gen_ai.tool.name"] == "inner"
    assert o.status.status_code == StatusCode.OK


async def test_async_step_and_error_status(spans):
    @memtrace.trace_step()
    async def boom():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        await boom()
    s = by_name(spans, "boom")
    assert s.status.status_code == StatusCode.ERROR
    assert s.events[0].name == "exception"


async def test_cancellation_closes_span(spans):
    @memtrace.trace_step(name="slow")
    async def slow():
        await asyncio.sleep(10)

    task = asyncio.ensure_future(slow())
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert by_name(spans, "slow").status.status_code == StatusCode.ERROR
    assert get_service().active_runs == 0


def test_run_id_context(spans):
    with memtrace.trace_step_context("blk") as run_id:
        assert memtrace.get_current_run_id() == run_id
    assert memtrace.get_current_run_id() is None


def test_service_run_inherits_current_otel_context(spans):
    """El handler de LangChain usa start_run sin parent_run_id dentro de un @trace_step."""
    service = get_service()
    with memtrace.trace_step_context("outer"):
        rid = service.start_run("external")
        service.end_run(rid)
    o, e = by_name(spans, "outer"), by_name(spans, "external")
    assert e.parent.span_id == o.context.span_id


def _llm_step():
    with memtrace.trace_step_context("llm", step_type="llm"):
        memtrace.trace_llm_call(
            "openai", "gpt-4o", input_tokens=10, output_tokens=5,
            input_messages=[{"role": "user", "content": "hola"}],
            finish_reasons=["stop"], temperature=0.2,
        )


def test_llm_call_attributes_without_content(spans):
    _llm_step()
    a = by_name(spans, "llm").attributes
    assert a["gen_ai.provider.name"] == "openai"
    assert a["gen_ai.request.model"] == "gpt-4o"
    assert a["gen_ai.usage.total_tokens"] == 15
    assert a["gen_ai.response.finish_reasons"] == ("stop",)
    assert a["gen_ai.request.temperature"] == 0.2
    assert "gen_ai.input.messages" not in a and "gen_ai.system" not in a


def test_llm_call_content_when_enabled(spans_capture):
    _llm_step()
    assert "hola" in by_name(spans_capture, "llm").attributes["gen_ai.input.messages"]


def test_step_content_not_captured_by_default(spans):
    @memtrace.trace_step(name="t", step_type="tool")
    def t(q):
        return "res"

    t("x")
    a = by_name(spans, "t").attributes
    assert "gen_ai.tool.call.arguments" not in a and a["gen_ai.tool.name"] == "t"


def test_step_content_captured_when_enabled(spans_capture):
    @memtrace.trace_step(name="t", step_type="tool")
    def t(q):
        return "res"

    t("x")
    a = by_name(spans_capture, "t").attributes
    assert '"q": "x"' in a["gen_ai.tool.call.arguments"]
    assert a["gen_ai.tool.call.result"] == '"res"'


def test_session_sets_conversation_id(spans):
    with memtrace.session("conv-1"):
        with memtrace.trace_step_context("s"):
            pass
    assert by_name(spans, "s").attributes["gen_ai.conversation.id"] == "conv-1"


def test_stale_span_is_expired_and_flagged(spans):
    service = get_service()
    rid = service.start_run("orphan")
    service.expire_stale(now=time.time() + 10_000)
    assert service.active_runs == 0
    assert by_name(spans, "orphan").attributes["memtrace.span.expired"] is True


def test_disabled_is_noop(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_ENABLED", "false")
    memtrace.init_tracer()

    @memtrace.trace_step()
    def f():
        return 42

    assert f() == 42
    memtrace.trace_llm_call("openai", "gpt-4o")
    memtrace.flush()
    memtrace.shutdown()


def test_flush_returns_true(spans):
    assert memtrace.flush() is True
