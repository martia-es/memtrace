"""End-to-end through the real OTLP path against an in-process gRPC/HTTP-less fake collector."""
import http.server
import threading

import pytest

import memtrace


class _Collector(http.server.BaseHTTPRequestHandler):
    bodies = []
    headers_seen = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        type(self).bodies.append(self.rfile.read(length))
        type(self).headers_seen.append(dict(self.headers))
        self.send_response(200)
        self.send_header("Content-Type", "application/x-protobuf")
        self.end_headers()

    def log_message(self, *args):
        pass


@pytest.fixture
def collector():
    pytest.importorskip("opentelemetry.exporter.otlp.proto.http.trace_exporter")
    _Collector.bodies, _Collector.headers_seen = [], []
    server = http.server.HTTPServer(("127.0.0.1", 0), _Collector)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", _Collector
    server.shutdown()


def test_otlp_http_roundtrip_delivers_spans_with_headers(collector):
    endpoint, handler = collector
    memtrace.shutdown()
    memtrace.init_tracer(
        service_name="e2e", endpoint=endpoint, protocol="http/protobuf", headers={"x-api-key": "k-123"}
    )

    @memtrace.trace_step(name="e2e-step", step_type="agent")
    def step():
        memtrace.trace_llm_call("openai", "gpt-4o", input_tokens=1, output_tokens=2)

    step()
    assert memtrace.flush() is True
    memtrace.shutdown()

    assert handler.bodies, "collector received nothing"
    assert b"e2e-step" in b"".join(handler.bodies)
    assert any(h.get("x-api-key") == "k-123" for h in handler.headers_seen)


def test_unreachable_collector_never_breaks_user_code():
    memtrace.shutdown()
    memtrace.init_tracer(endpoint="http://127.0.0.1:1", protocol="grpc")

    @memtrace.trace_step()
    def f():
        return "still works"

    assert f() == "still works"
    memtrace.shutdown()
