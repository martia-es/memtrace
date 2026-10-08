"""HTTP and disk adapters of the prompt registry, and the wiring with the tracer (ADR-068)."""
import json
import os
import statistics
import time

import httpx
import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import memtrace
from memtrace import prompts
from memtrace.adapters.outbound.file_prompt_cache import FilePromptCache
from memtrace.adapters.outbound.http.prompt_client import HttpPromptClient
from memtrace.application.prompt_ports import PromptSourceError, UsedPrompt
from memtrace.application.prompt_registry import PromptRegistry
from memtrace.domain.prompt import PromptNotFoundError, PromptUnavailableError, PromptVersion

BASE = "http://memtrace.test/api/v1/experiments/e1"
BODY = {"name": "weather-system", "version": 3, "tag": "pro", "content": "Hola {{ciudad}}", "variables": ["ciudad"], "contentHash": "abc", "archived": False}


def client(handler) -> HttpPromptClient:
    return HttpPromptClient(BASE, "mtk_x", transport=httpx.MockTransport(handler))


# ----- HTTP -----


def test_asks_for_a_tag_with_the_agent_api_key_and_parses_the_version():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=BODY, headers={"ETag": '"v3-abc"'})

    fetched = client(handler).fetch("weather-system", "pro", None, None)
    (request,) = seen
    assert request.method == "GET"
    assert request.url.path == "/api/v1/experiments/e1/prompts/resolve"
    assert dict(request.url.params) == {"name": "weather-system", "tag": "pro"}
    assert request.headers["authorization"] == "Bearer mtk_x"
    assert "if-none-match" not in request.headers
    assert fetched.etag == '"v3-abc"'
    assert fetched.version == PromptVersion(name="weather-system", version=3, content="Hola {{ciudad}}", variables=("ciudad",), content_hash="abc")


def test_asks_for_a_version_and_sends_the_etag_it_already_has():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(304)

    assert client(handler).fetch("weather-system", None, 3, '"v3-abc"') is None
    assert dict(seen[0].url.params) == {"name": "weather-system", "version": "3"}
    assert seen[0].headers["if-none-match"] == '"v3-abc"'


def test_a_404_is_a_not_found_error_with_the_server_explanation():
    handler = lambda request: httpx.Response(404, json={"title": "Not Found", "detail": "Tag \"pro\" of \"weather-system\" not found"})  # noqa: E731
    with pytest.raises(PromptNotFoundError, match='Tag "pro"'):
        client(handler).fetch("weather-system", "pro", None, None)


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_other_errors_are_transient_source_errors(status):
    with pytest.raises(PromptSourceError, match=str(status)):
        client(lambda request: httpx.Response(status, json={"title": "x"})).fetch("weather-system", "pro", None, None)


def test_network_failures_are_source_errors_not_httpx_exceptions():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(PromptSourceError, match="ConnectError"):
        client(handler).fetch("weather-system", "pro", None, None)


def test_reports_usage_with_the_environment_and_every_item():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"recorded": 2, "received": 2})

    client(handler).report("pro", [UsedPrompt("a", "pro", 2), UsedPrompt("b", None, 5)])
    (request,) = seen
    assert request.method == "POST" and request.url.path.endswith("/prompts/usage")
    assert json.loads(request.content) == {"environment": "pro", "items": [{"name": "a", "tag": "pro", "version": 2}, {"name": "b", "tag": None, "version": 5}]}


def test_a_rejected_report_is_a_source_error():
    with pytest.raises(PromptSourceError):
        client(lambda request: httpx.Response(500, json={})).report(None, [UsedPrompt("a", None, 1)])


# ----- disk cache -----


def test_cache_roundtrip_and_overwrite(tmp_path):
    cache = FilePromptCache(str(tmp_path / "prompts"))
    assert cache.load("weather-system", "pro", None) is None
    cache.store("weather-system", "pro", None, PromptVersion("weather-system", 1, "uno", ("a",), "h1"))
    cache.store("weather-system", "pro", None, PromptVersion("weather-system", 2, "dos", (), "h2"))
    assert cache.load("weather-system", "pro", None) == PromptVersion("weather-system", 2, "dos", (), "h2")
    assert cache.load("weather-system", "dev", None) is None  # another tag


def test_a_corrupt_cache_file_is_just_a_miss(tmp_path):
    cache = FilePromptCache(str(tmp_path))
    cache.store("weather-system", "pro", None, PromptVersion("weather-system", 1, "uno"))
    for name in os.listdir(tmp_path):
        (tmp_path / name).write_text("{not json")
    assert cache.load("weather-system", "pro", None) is None


def test_an_unwritable_cache_directory_never_raises(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    FilePromptCache(str(blocker / "sub")).store("weather-system", "pro", None, PromptVersion("weather-system", 1, "uno"))


def test_names_cannot_escape_the_cache_directory(tmp_path):
    cache = FilePromptCache(str(tmp_path))
    cache.store("../../etc/passwd", "pro", None, PromptVersion("x", 1, "uno"))
    assert [p.parent for p in tmp_path.rglob("*.json")] == [tmp_path]


# ----- registry + http + cache, the agent restarts while MemTrace is down -----


def test_an_agent_restarting_while_memtrace_is_down_starts_from_the_disk_cache(tmp_path):
    cache = FilePromptCache(str(tmp_path))
    up = client(lambda request: httpx.Response(200, json=BODY, headers={"ETag": '"v3-abc"'}))
    PromptRegistry(up, usage=None, cache=cache, environment="pro").get("weather-system")

    def down(request):
        raise httpx.ConnectError("refused")

    restarted = PromptRegistry(client(down), cache=cache, environment="pro")
    handle = restarted.get("weather-system")
    assert (handle.version, handle.compile(ciudad="Sevilla")) == (3, "Hola Sevilla")
    restarted.shutdown()


# ----- tracer wiring -----


@pytest.fixture
def exporter(monkeypatch):
    memtrace.shutdown()
    monkeypatch.delenv("MEMTRACE_API_URL", raising=False)
    monkeypatch.delenv("MEMTRACE_ENVIRONMENT", raising=False)
    exp = InMemorySpanExporter()
    memtrace.init_tracer(service_name="prompt-test", span_exporter=exp)
    yield exp
    memtrace.shutdown()


def test_compile_links_the_trace_to_the_prompt_version(exporter):
    from memtrace.dependency_container import _annotate_current_span

    source_version = PromptVersion("weather-system", 4, "Hola {{ciudad}}", ("ciudad",), "h4")

    class Source:
        def fetch(self, name, tag, version, etag):
            from memtrace.application.prompt_ports import Fetched

            return Fetched(source_version, '"v4"')

    registry = PromptRegistry(Source(), annotate=_annotate_current_span, environment="dev")
    handle = registry.get("weather-system")

    @memtrace.trace_step(name="turn", step_type="agent")
    def turn():
        return handle.compile(ciudad="Sevilla")

    assert turn() == "Hola Sevilla"
    memtrace.flush()
    (span,) = [s for s in exporter.get_finished_spans() if s.name == "turn"]
    assert span.attributes["memtrace.prompt.name"] == "weather-system"
    assert span.attributes["memtrace.prompt.version"] == 4
    registry.shutdown()


def test_compile_outside_any_span_is_harmless(exporter):
    from memtrace.dependency_container import _annotate_current_span

    registry = PromptRegistry(None, annotate=_annotate_current_span, environment="dev")
    assert registry.get("x", default="ok").compile() == "ok"


def test_the_public_module_works_offline_with_a_default_and_shutdown_resets_it(monkeypatch):
    memtrace.shutdown()
    monkeypatch.delenv("MEMTRACE_API_URL", raising=False)
    monkeypatch.setenv("MEMTRACE_ENVIRONMENT", "dev")
    handle = prompts.get("weather-system", default="Hola {{ciudad}}")
    assert handle.compile(ciudad="Sevilla") == "Hola Sevilla"
    with pytest.raises(PromptUnavailableError):
        prompts.get("sin-default")
    memtrace.shutdown()


def test_aget_loads_without_blocking_the_event_loop(monkeypatch):
    import asyncio

    memtrace.shutdown()
    monkeypatch.delenv("MEMTRACE_API_URL", raising=False)
    monkeypatch.setenv("MEMTRACE_ENVIRONMENT", "dev")
    handle = asyncio.run(prompts.aget("weather-system", default="async {{x}}"))
    assert handle.compile(x=1) == "async 1"
    memtrace.shutdown()


# ----- performance budget (ADR-068): compile() is memory only -----


def test_compile_has_no_network_and_stays_within_the_latency_budget(exporter):
    from memtrace.application.prompt_ports import Fetched
    from memtrace.dependency_container import _annotate_current_span

    calls = []

    class Source:
        def fetch(self, name, tag, version, etag):
            calls.append(1)
            return Fetched(PromptVersion("weather-system", 1, "Eres un asistente del tiempo para {{ciudad}}. " * 40, ("ciudad",), "h"), '"v1"')

    registry = PromptRegistry(Source(), annotate=_annotate_current_span, environment="dev")
    handle = registry.get("weather-system")
    calls.clear()

    samples = []

    @memtrace.trace_step(name="bench", step_type="agent")
    def bench():
        for _ in range(5000):
            started = time.perf_counter()
            handle.compile(ciudad="Sevilla")
            samples.append((time.perf_counter() - started) * 1000)

    bench()
    samples.sort()
    p50, p99 = statistics.median(samples), samples[int(len(samples) * 0.99)]
    print(f"compile() with a live span: p50={p50:.4f} ms, p99={p99:.4f} ms")
    assert calls == [], "compile() must not call the registry"
    assert p99 < 1.0, f"compile() p99 {p99:.3f} ms exceeds the 1 ms budget"
    registry.shutdown()
