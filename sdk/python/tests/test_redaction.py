import json

import memtrace
from memtrace.domain.serialization import REDACTED, to_json
from tests.conftest import by_name


def test_sensitive_keys_are_masked_recursively_and_case_insensitively():
    payload = {"user": "ana", "Authorization": "Bearer abc", "nested": [{"OPENAI_API_KEY": "sk-1", "n": 1}]}
    out = json.loads(to_json(payload))
    assert out["user"] == "ana"
    assert out["Authorization"] == REDACTED
    assert out["nested"][0] == {"OPENAI_API_KEY": REDACTED, "n": 1}


def test_token_counts_are_not_masked():
    out = json.loads(to_json({"input_tokens": 3, "max_tokens": 10, "access_token": "x"}))
    assert out == {"input_tokens": 3, "max_tokens": 10, "access_token": REDACTED}


def test_huge_payloads_are_bounded_before_serialization():
    big = {"text": "x" * 5_000_000, "items": list(range(100_000))}
    out = to_json(big, limit=1000)
    assert len(out) <= 1000 + len("…[truncated]")


def test_deep_nesting_does_not_blow_up():
    value = current = {}
    for _ in range(500):
        current["k"] = {}
        current = current["k"]
    assert "max depth" in to_json(value)


def test_unserializable_objects_fall_back_to_str():
    class Weird:
        def __str__(self):
            return "weird!"

    assert json.loads(to_json({"w": Weird()})) == {"w": "weird!"}


def test_decorator_masks_sensitive_arguments(spans_capture):
    @memtrace.trace_step(name="call_api", step_type="tool")
    def call_api(query, api_key):
        return "ok"

    call_api("q", api_key="sk-live-123")
    args = by_name(spans_capture, "call_api").attributes["gen_ai.tool.call.arguments"]
    assert "sk-live-123" not in args and REDACTED in args and '"query": "q"' in args


def test_env_extends_redact_keys(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true")
    monkeypatch.setenv("MEMTRACE_REDACT_KEYS", "ssn, Phone")
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    memtrace.init_tracer(span_exporter=exporter)

    @memtrace.trace_step(name="t", step_type="tool")
    def t(ssn, phone_number, name):
        return None

    t("123-45", "600", "ana")
    args = by_name(exporter, "t").attributes["gen_ai.tool.call.arguments"]
    assert "123-45" not in args and "600" not in args and "ana" in args
    memtrace.shutdown()


def test_init_tracer_redact_hook(monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true")
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    memtrace.init_tracer(span_exporter=exporter, redact=lambda d: {"only": "this"})

    @memtrace.trace_step(name="t", step_type="tool")
    def t(x):
        return None

    t("secret")
    assert by_name(exporter, "t").attributes["gen_ai.tool.call.arguments"] == '{"only": "this"}'
    memtrace.shutdown()
