import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import memtrace


def _init(monkeypatch, capture: bool):
    memtrace.shutdown()
    monkeypatch.setenv("MEMTRACE_CAPTURE_CONTENT", "true" if capture else "false")
    exporter = InMemorySpanExporter()
    memtrace.init_tracer(service_name="test-agent", span_exporter=exporter)
    return exporter


@pytest.fixture
def spans(monkeypatch):
    """MemTrace con exporter en memoria y captura de contenido desactivada."""
    yield _init(monkeypatch, capture=False)
    memtrace.shutdown()


@pytest.fixture
def spans_capture(monkeypatch):
    """Igual que `spans`, con MEMTRACE_CAPTURE_CONTENT=true."""
    yield _init(monkeypatch, capture=True)
    memtrace.shutdown()


def by_name(exporter, name):
    (span,) = [s for s in exporter.get_finished_spans() if s.name == name]
    return span
