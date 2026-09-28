import logging

import memtrace
from memtrace.dependency_container import get_service


def test_reinit_with_different_arguments_warns(caplog):
    memtrace.shutdown()
    memtrace.init_tracer(service_name="first", span_exporter=None)
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        memtrace.init_tracer(service_name="second")
    assert "ignored service_name" in caplog.text
    memtrace.shutdown()


def test_reinit_with_same_or_no_arguments_is_silent(caplog):
    memtrace.shutdown()
    memtrace.init_tracer(service_name="same")
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        assert memtrace.init_tracer(service_name="same") is memtrace.init_tracer()
    assert not caplog.records
    memtrace.shutdown()


def test_implicit_init_then_explicit_init_warns(caplog, monkeypatch):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_ENABLED", "false")
    get_service()  # e.g. a @trace_step executed before init_tracer
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        memtrace.init_tracer(service_name="late")
    assert "ignored service_name" in caplog.text
    memtrace.shutdown()


def test_shutdown_allows_reconfiguration():
    memtrace.shutdown()
    a = memtrace.init_tracer(service_name="a")
    memtrace.shutdown()
    assert memtrace.init_tracer(service_name="b") is not a
    memtrace.shutdown()


def test_explicit_service_isolated_from_global(spans):
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from memtrace.adapters.outbound.otel.factory import OtelConfig, create_otel_adapter
    from memtrace.application.tracing_service import TracingService

    other_exporter = InMemorySpanExporter()
    other = TracingService(create_otel_adapter(OtelConfig("other", "x", "grpc"), other_exporter))

    @memtrace.trace_step(name="mine", service=other)
    def mine():
        return 1

    mine()
    assert [s.name for s in other_exporter.get_finished_spans()] == ["mine"]
    assert not spans.get_finished_spans()
    other.shutdown()
