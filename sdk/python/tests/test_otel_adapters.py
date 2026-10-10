import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from memtrace.adapters.outbound.otel.attribute_sanitizer import sanitize, sanitize_value
from memtrace.adapters.outbound.otel.exporter_factory import build_otlp_exporter
from memtrace.adapters.outbound.otel.session_processor import SessionSpanProcessor
from memtrace.application.context import session


def test_sanitize_drops_none_and_coerces_types():
    out = sanitize({"a": None, "b": 1, "c": ["x", "y"], "d": [1, "mixed"], "e": {"k": 1}, "f": object, "g": []})
    assert "a" not in out
    assert out["b"] == 1 and out["c"] == ["x", "y"]
    assert out["d"] == '[1, "mixed"]' and out["e"] == '{"k": 1}'
    assert isinstance(out["f"], str) and out["g"] == "[]"


def test_sanitize_value_keeps_bool_before_int():
    assert sanitize_value(True) is True


def test_grpc_exporter_is_built_for_http_and_https_endpoints():
    pytest.importorskip("opentelemetry.exporter.otlp.proto.grpc.trace_exporter")
    assert build_otlp_exporter("grpc", "http://localhost:4317", {"k": "v"}, 1000) is not None
    assert build_otlp_exporter("grpc", "https://collector:4317", None, 1000) is not None


def test_http_exporter_appends_traces_path():
    exporter = build_otlp_exporter("http/protobuf", "http://localhost:4318", None, 1000)
    assert exporter._endpoint == "http://localhost:4318/v1/traces"
    keep = build_otlp_exporter("http/protobuf", "http://x/v1/traces/", None, 1000)
    assert keep._endpoint.endswith("/v1/traces/") or keep._endpoint.endswith("/v1/traces")


def test_unknown_protocol_is_rejected():
    with pytest.raises(ValueError, match="Unsupported OTLP protocol"):
        build_otlp_exporter("carrier-pigeon", "x", None, 1000)


def test_session_processor_tags_foreign_spans_and_leaves_memtrace_spans_alone():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SessionSpanProcessor())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    foreign, own = provider.get_tracer("some.library"), provider.get_tracer("memtrace")
    with session("s-1"):
        foreign.start_span("plain").end()
        foreign.start_span("library-own-id", attributes={"gen_ai.conversation.id": "generated"}).end()
        own.start_span("explicit", attributes={"gen_ai.conversation.id": "mine"}).end()
    foreign.start_span("outside").end()
    got = {s.name: s.attributes.get("gen_ai.conversation.id") for s in exporter.get_finished_spans()}
    assert got == {"plain": "s-1", "library-own-id": "s-1", "explicit": "mine", "outside": None}


def test_revision_is_a_resource_attribute():
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from memtrace.adapters.outbound.otel.factory import OtelConfig, create_otel_adapter

    exporter = InMemorySpanExporter()
    adapter = create_otel_adapter(
        OtelConfig(service_name="svc", endpoint="x", protocol="grpc", revision="a" * 40, revision_dirty=False), exporter
    )
    adapter._provider.get_tracer("t").start_span("s").end()
    attrs = exporter.get_finished_spans()[0].resource.attributes
    assert attrs["vcs.repository.ref.revision"] == "a" * 40
    assert attrs["memtrace.revision.dirty"] == "false"
