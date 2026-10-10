"""Regression: auto-instrumentors must export through MemTrace's tracer, not a global provider."""
import contextvars

import pytest

import memtrace
from tests.conftest import by_name


def _names(exporter):
    return [s.name for s in exporter.get_finished_spans()]


def test_pydantic_ai_spans_reach_memtrace_exporter(spans):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    Agent(TestModel()).run_sync("hi")

    assert any("agent run" in n or "chat" in n for n in _names(spans)), _names(spans)


def test_pydantic_ai_span_is_child_of_trace_step_and_carries_session(spans):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    agent = Agent(TestModel())
    with memtrace.session("conv-42"):
        with memtrace.trace_step_context("outer"):
            agent.run_sync("hi")

    outer = by_name(spans, "outer")
    others = [s for s in spans.get_finished_spans() if s is not outer]
    assert others and all(s.context.trace_id == outer.context.trace_id for s in others)
    assert all(s.attributes.get("gen_ai.conversation.id") == "conv-42" for s in others)


def test_pydantic_ai_content_recorded_when_capture_enabled(spans_capture):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    Agent(TestModel()).run_sync("top-secret-prompt")
    blob = " ".join(str(dict(s.attributes)) + str(s.events) for s in spans_capture.get_finished_spans())
    assert "top-secret-prompt" in blob


def test_pydantic_ai_content_hidden_by_default(spans):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    Agent(TestModel()).run_sync("top-secret-prompt")
    blob = " ".join(str(dict(s.attributes)) + str(s.events) for s in spans.get_finished_spans())
    assert "top-secret-prompt" not in blob


def test_pydantic_ai_disabled_tracing_is_skipped(monkeypatch):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent

    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_ENABLED", "false")
    memtrace.init_tracer()
    before = Agent._instrument_default
    memtrace.enable_pydantic_ai_instrumentation()
    assert Agent._instrument_default == before
    memtrace.shutdown()


def test_langchain_auto_spans_reach_memtrace_exporter(spans):
    pytest.importorskip("opentelemetry.instrumentation.langchain")
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from opentelemetry.instrumentation.langchain import LangchainInstrumentor

    memtrace.enable_langchain_instrumentation()
    try:
        # some instrumentor releases leave their span attached; keep it out of other tests
        contextvars.copy_context().run(FakeListChatModel(responses=["yo"]).invoke, "hi")
    finally:
        LangchainInstrumentor().uninstrument()

    assert _names(spans)


def test_langchain_auto_survives_shutdown_and_reinit():
    pytest.importorskip("opentelemetry.instrumentation.langchain")
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from opentelemetry.instrumentation.langchain import LangchainInstrumentor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    try:
        for _ in range(3):  # each round binds to a new provider; the instrumentor is bound only once
            memtrace.shutdown()
            exporter = InMemorySpanExporter()
            memtrace.init_tracer(span_exporter=exporter)
            memtrace.enable_langchain_instrumentation()
            contextvars.copy_context().run(FakeListChatModel(responses=["yo"]).invoke, "hi")
            assert _names(exporter)
    finally:
        LangchainInstrumentor().uninstrument()
        memtrace.shutdown()


def test_langchain_auto_spans_are_dropped_quietly_after_shutdown(spans, caplog):
    pytest.importorskip("opentelemetry.instrumentation.langchain")
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from opentelemetry.instrumentation.langchain import LangchainInstrumentor

    try:
        memtrace.enable_langchain_instrumentation()
        memtrace.shutdown()
        with caplog.at_level("WARNING"):
            contextvars.copy_context().run(FakeListChatModel(responses=["yo"]).invoke, "hi")
        assert "already shutdown" not in caplog.text
    finally:
        LangchainInstrumentor().uninstrument()


def test_auto_spans_get_step_type_for_the_dashboard(spans):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    Agent(TestModel()).run_sync("hi")
    kinds = {s.name.split()[0]: s.attributes.get("memtrace.step_type") for s in spans.get_finished_spans()}
    assert kinds["invoke_agent"] == "agent" and kinds["chat"] == "llm"


def test_pydantic_ai_prompt_secrets_are_redacted_even_with_capture_on(spans_capture):
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    memtrace.enable_pydantic_ai_instrumentation()
    Agent(TestModel()).run_sync("use key sk-abcdefghijklmnopqrstuvwx and password=hunter2 please")
    blob = " ".join(str(dict(s.attributes)) + str(s.events) for s in spans_capture.get_finished_spans())
    assert "use key" in blob  # content is captured...
    assert "sk-abcdefghijkl" not in blob and "hunter2" not in blob  # ...but secrets are not


def test_missing_extra_raises_clear_import_error(monkeypatch, spans):
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith(("pydantic_ai", "opentelemetry.instrumentation.langchain")):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(ImportError, match="memtrace-ai\\[pydantic-ai\\]"):
        memtrace.enable_pydantic_ai_instrumentation()
    with pytest.raises(ImportError, match="memtrace-ai\\[langchain\\]"):
        memtrace.enable_langchain_instrumentation()
