import json

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import memtrace
from memtrace.adapters.outbound.otel.sanitizing_exporter import SanitizingSpanExporter
from memtrace.adapters.outbound.otel.switchable_provider import SwitchableTracerProvider
from memtrace.domain.redaction import Redactor
from memtrace.domain.serialization import REDACTED, SERIALIZATION_FAILED
from tests.conftest import by_name


def _pipeline(redactor=None):
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(SanitizingSpanExporter(memory, redactor or Redactor())))
    return provider.get_tracer("third.party"), memory


def _one(memory):
    (span,) = memory.get_finished_spans()
    return span


@pytest.mark.parametrize(
    "secret",
    [
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_" + "a" * 36,
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
        "mtk_Ab3xY9Zq1234567",
        "xoxb-1234567890-abcdefghij",
    ],
)
def test_secrets_with_a_known_shape_are_masked_anywhere_in_text(secret):
    tracer, memory = _pipeline()
    tracer.start_span("s", attributes={"free.text": f"please call with {secret} now"}).end()
    text = _one(memory).attributes["free.text"]
    assert secret not in text and REDACTED in text and text.startswith("please call with")


def test_key_value_pairs_bearer_url_credentials_and_private_keys_in_text():
    tracer, memory = _pipeline()
    text = (
        "GET https://ana:hunter2@host/x?api_key=abc123&q=1 Authorization: Bearer abcdefgh12345678 "
        "password=p4ss -----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----"
    )
    tracer.start_span("s", attributes={"note": text}).end()
    out = _one(memory).attributes["note"]
    for leaked in ("hunter2", "abc123", "abcdefgh12345678", "p4ss", "MIIB"):
        assert leaked not in out
    assert "q=1" in out and "host" in out


def test_attribute_named_like_a_secret_is_masked_whatever_its_value():
    tracer, memory = _pipeline()
    tracer.start_span("s", attributes={"http.request.header.authorization": "anything", "gen_ai.usage.input_tokens": 5}).end()
    attrs = _one(memory).attributes
    assert attrs["http.request.header.authorization"] == REDACTED and attrs["gen_ai.usage.input_tokens"] == 5


def test_json_attributes_are_masked_by_key_and_by_value():
    tracer, memory = _pipeline()
    blob = json.dumps({"user": "ana", "api_key": "x", "msgs": [{"content": "my key is sk-abcdefghijklmnopqrstu"}]})
    tracer.start_span("s", attributes={"gen_ai.input.messages": blob}).end()
    out = json.loads(_one(memory).attributes["gen_ai.input.messages"])
    assert out["user"] == "ana" and out["api_key"] == REDACTED
    assert "sk-abcdefghij" not in out["msgs"][0]["content"]


def test_exception_events_and_status_message_are_scrubbed():
    tracer, memory = _pipeline()
    span = tracer.start_span("s")
    span.record_exception(RuntimeError("401 for https://u:pw123@api.example.com?token=1 Bearer abcdefgh12345678"))
    from opentelemetry.trace import Status, StatusCode

    span.set_status(Status(StatusCode.ERROR, "failed with password=hunter2"))
    span.end()
    out = _one(memory)
    blob = str([dict(e.attributes) for e in out.events])
    assert "pw123" not in blob and "abcdefgh12345678" not in blob
    assert "hunter2" not in out.status.description and out.status.status_code.name == "ERROR"
    assert out.events[0].name == "exception"


def test_hook_sees_content_values_and_can_rewrite_them():
    seen = []

    def hook(value):
        seen.append(value)
        return json.loads(json.dumps(value).replace("ana@example.com", "<email>")) if not isinstance(value, str) else value.replace("ana@example.com", "<email>")

    tracer, memory = _pipeline(Redactor(hook=hook))
    tracer.start_span("s", attributes={"gen_ai.input.messages": json.dumps({"m": "mail ana@example.com"}), "content": "hi ana@example.com", "model": "gpt"}).end()
    attrs = _one(memory).attributes
    assert "ana@example.com" not in attrs["gen_ai.input.messages"] and attrs["content"] == "hi <email>"
    assert attrs["model"] == "gpt" and len(seen) == 2  # plain non-content attributes never reach the hook


def test_failing_hook_fails_closed():
    def boom(_):
        raise RuntimeError("bug in user hook")

    tracer, memory = _pipeline(Redactor(hook=boom))
    tracer.start_span("s", attributes={"gen_ai.input.messages": json.dumps({"a": 1}), "content": "secret text"}).end()
    attrs = _one(memory).attributes
    assert attrs["gen_ai.input.messages"] == json.dumps(SERIALIZATION_FAILED) and attrs["content"] == SERIALIZATION_FAILED


def test_span_that_cannot_be_sanitized_is_exported_without_content():
    class Broken(Redactor):
        def attribute(self, key, value):
            raise RuntimeError("boom")

    tracer, memory = _pipeline(Broken())
    tracer.start_span("s", attributes={"password": "x", "note": "hi"}).end()
    out = _one(memory)
    assert dict(out.attributes) == {"memtrace.redaction_failed": True} and not out.events


def test_step_type_is_inferred_only_when_missing():
    tracer, memory = _pipeline()
    tracer.start_span("a", attributes={"gen_ai.operation.name": "invoke_agent"}).end()
    tracer.start_span("b", attributes={"gen_ai.operation.name": "execute_tool", "memtrace.step_type": "custom"}).end()
    tracer.start_span("c", attributes={"traceloop.span.kind": "workflow"}).end()
    tracer.start_span("d").end()
    got = {s.name: s.attributes.get("memtrace.step_type") for s in memory.get_finished_spans()}
    assert got == {"a": "agent", "b": "custom", "c": "chain", "d": None}


def test_timing_ids_and_parenting_are_preserved():
    tracer, memory = _pipeline()
    parent = tracer.start_span("p")
    from opentelemetry import trace

    child = tracer.start_span("c", context=trace.set_span_in_context(parent))
    child.end()
    parent.end()
    spans = {s.name: s for s in memory.get_finished_spans()}
    assert spans["c"].parent.span_id == spans["p"].context.span_id
    assert spans["c"].context.trace_id == spans["p"].context.trace_id
    assert spans["c"].end_time >= spans["c"].start_time


# ----- through the public API -----


def test_trace_llm_call_extra_attributes_are_redacted(spans):
    with memtrace.trace_step_context("llm", step_type="llm"):
        memtrace.trace_llm_call("openai", "gpt-4o", attributes={"api_key": "sk-live-1", "note": "Bearer abcdefgh12345678"})
    attrs = by_name(spans, "llm").attributes
    assert attrs["api_key"] == REDACTED and "abcdefgh12345678" not in attrs["note"]


def test_langchain_metadata_is_redacted_even_with_capture_off(spans):
    pytest.importorskip("langchain_core")
    import uuid

    from memtrace.adapters.inbound.langchain import MemTraceCallbackHandler

    handler, rid = MemTraceCallbackHandler(), uuid.uuid4()
    handler.on_chain_start({"name": "c"}, {}, run_id=rid, metadata={"thread_id": "t1", "user_password": "hunter2", "note": "token sk-abcdefghijklmnopqrstu"})
    handler.on_chain_end({}, run_id=rid)
    md = by_name(spans, "c").attributes["memtrace.metadata"]
    assert "hunter2" not in md and "sk-abcdefghij" not in md and "t1" in md


def test_error_message_secrets_are_not_exported(spans):
    with pytest.raises(ValueError):
        with memtrace.trace_step_context("boom"):
            raise ValueError("bad url https://u:pw123@h/?x=1")
    span = by_name(spans, "boom")
    assert "pw123" not in span.status.description and "pw123" not in str([dict(e.attributes) for e in span.events])


def test_init_tracer_redact_hook_reaches_all_spans(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true")
    memory = InMemorySpanExporter()
    memtrace.init_tracer(span_exporter=memory, redact=lambda d: {"only": "this"})

    @memtrace.trace_step(name="t", step_type="tool")
    def t(x):
        return None

    t("secret")
    assert by_name(memory, "t").attributes["gen_ai.tool.call.arguments"] == '{"only": "this"}'
    memtrace.shutdown()


# ----- switchable provider -----


def test_switchable_provider_follows_its_target_and_drops_when_unset():
    shared = SwitchableTracerProvider()
    tracer = shared.get_tracer("lib")
    tracer.start_span("nowhere").end()  # no target: dropped, no error

    first, second = InMemorySpanExporter(), InMemorySpanExporter()
    for exporter in (first, second):
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        shared.target = provider
        with tracer.start_as_current_span("x"):
            pass
    assert [s.name for s in first.get_finished_spans()] == ["x"]
    assert [s.name for s in second.get_finished_spans()] == ["x"]
