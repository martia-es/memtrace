"""Playground overrides in the agent (ADR-071): MemTrace tests a prompt version in the real agent for one request."""
import asyncio
import threading
from typing import Dict, List, Optional, Tuple

import httpx
import pytest

from memtrace.adapters.inbound.asgi import PromptOverrideMiddleware
from memtrace.adapters.outbound.http.prompt_client import HttpPromptClient
from memtrace.application.prompt_override import current_override, use_override
from memtrace.application.prompt_ports import Fetched, PromptSourceError
from memtrace.application.prompt_registry import PromptRegistry
from memtrace.domain.prompt import PromptVersion, is_override_token

TOKEN = "mto_" + "a" * 43
OTHER = "mto_" + "b" * 43


def version(n: int, content: str, name: str = "weather-system") -> PromptVersion:
    return PromptVersion(name=name, version=n, content=content)


class Source:
    """The tag is on v1; tokens grant other versions, like MemTrace would."""

    def __init__(self) -> None:
        self.grants: Dict[Tuple[str, str], PromptVersion] = {}
        self.override_calls: List[Tuple[str, str]] = []
        self.fail: Optional[Exception] = None

    def fetch(self, name, tag, version_number, etag):
        return Fetched(version(1, "del tag", name), None)

    def fetch_override(self, name, token):
        self.override_calls.append((name, token))
        if self.fail is not None:
            raise self.fail
        return self.grants.get((name, token))


def build(**kwargs):
    source = Source()
    stamps: List[dict] = []
    options = dict(annotate=stamps.append, environment="dev", allow_override=True)
    options.update(kwargs)
    registry = PromptRegistry(source, **options)
    return registry, source, stamps


@pytest.fixture(autouse=True)
def _stop_threads():
    created = []
    original = PromptRegistry.__init__

    def tracking(self, *args, **kwargs):
        original(self, *args, **kwargs)
        created.append(self)

    PromptRegistry.__init__ = tracking
    yield
    PromptRegistry.__init__ = original
    for registry in created:
        registry.shutdown()


# ----- the registry -----


def test_the_override_applies_only_inside_the_request_that_carries_it():
    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")
    assert handle.compile() == "del tag"
    with use_override(TOKEN):
        assert handle.compile() == "del override"
    assert handle.compile() == "del tag"  # the block ended: nothing leaks to the next request


def test_it_does_nothing_unless_the_agent_opted_in():
    registry, source, _ = build(allow_override=False)
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")
    with use_override(TOKEN):
        assert handle.compile() == "del tag"
    assert source.override_calls == []  # MemTrace is not even asked


def test_a_token_that_does_not_look_like_one_is_ignored_without_asking_anyone():
    registry, source, _ = build()
    handle = registry.get("weather-system")
    for junk in ("", "Bearer abc", "mto_", "mto_short", "x" * 50, "mto_" + "a" * 500):
        with use_override(junk):
            assert handle.compile() == "del tag"
    assert source.override_calls == []
    assert [is_override_token(TOKEN), is_override_token("mto_short"), is_override_token(None)] == [True, False, False]


def test_a_token_for_another_prompt_does_not_change_this_one():
    registry, source, _ = build()
    source.grants[("tone", TOKEN)] = version(3, "tono override", "tone")
    weather = registry.get("weather-system")
    with use_override(TOKEN):
        assert weather.compile() == "del tag"  # MemTrace has no grant of this token for this prompt


def test_a_token_rejected_by_memtrace_falls_back_to_the_tag_and_warns(caplog):
    registry, _, _ = build()
    handle = registry.get("weather-system")
    with caplog.at_level("WARNING", logger="memtrace"):
        with use_override(TOKEN):
            assert handle.compile() == "del tag"
    assert any("not accepted" in r.getMessage() for r in caplog.records)


def test_memtrace_being_down_never_breaks_the_request():
    registry, source, _ = build()
    source.fail = PromptSourceError("connection refused")
    handle = registry.get("weather-system")
    with use_override(TOKEN):
        assert handle.compile() == "del tag"


def test_the_grant_is_cached_for_the_requests_that_follow_in_the_same_run_but_a_transient_failure_is_not():
    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")
    with use_override(TOKEN):
        for _ in range(5):
            assert handle.compile() == "del override"
    assert len(source.override_calls) == 1

    source.fail = PromptSourceError("down")
    with use_override(OTHER):
        handle.compile()
        handle.compile()
    assert len(source.override_calls) == 3  # the failure was retried, not remembered
    source.fail = None
    source.grants[("weather-system", OTHER)] = version(8, "otro override")
    with use_override(OTHER):
        assert handle.compile() == "otro override"


def test_a_rejection_is_remembered_so_a_wrong_token_does_not_hammer_memtrace():
    registry, source, _ = build()
    handle = registry.get("weather-system")
    with use_override(TOKEN):
        for _ in range(5):
            handle.compile()
    assert len(source.override_calls) == 1


def test_the_span_says_it_is_a_playground_run_of_that_version_and_a_normal_compile_does_not():
    registry, source, stamps = build()
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")
    handle.compile()
    with use_override(TOKEN):
        handle.compile()
    assert stamps[0] == {"memtrace.prompt.name": "weather-system", "memtrace.prompt.version": 1}
    assert stamps[1] == {"memtrace.prompt.name": "weather-system", "memtrace.prompt.version": 7, "memtrace.playground": True}


def test_the_usage_report_keeps_telling_the_truth_about_the_tag():
    source_usage = _Usage()
    registry, source, _ = build(usage=source_usage)
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")
    with use_override(TOKEN):
        handle.compile()
    registry.run_once()
    assert [(i.name, i.version) for r in source_usage.reports for i in r] == [("weather-system", 1)]  # v7 was an experiment


class _Usage:
    def __init__(self) -> None:
        self.reports: List[list] = []

    def report(self, environment, items):
        self.reports.append(list(items))


def test_concurrent_requests_never_see_each_others_override():
    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "uno")
    source.grants[("weather-system", OTHER)] = version(8, "dos")
    handle = registry.get("weather-system")
    barrier = threading.Barrier(2)
    seen: Dict[str, List[str]] = {}

    def request(token: str) -> None:
        with use_override(token):
            barrier.wait(timeout=5)  # both requests are inside their block at the same time
            seen[token] = [handle.compile() for _ in range(50)]

    threads = [threading.Thread(target=request, args=(t,)) for t in (TOKEN, OTHER)]
    [t.start() for t in threads]
    [t.join(timeout=10) for t in threads]
    assert set(seen[TOKEN]) == {"uno"} and set(seen[OTHER]) == {"dos"}


@pytest.mark.asyncio
async def test_concurrent_async_requests_never_see_each_others_override():
    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "uno")
    handle = registry.get("weather-system")

    async def request(token: Optional[str]) -> str:
        with use_override(token):
            await asyncio.sleep(0.01)
            return handle.compile()

    assert await asyncio.gather(request(TOKEN), request(None), request(TOKEN)) == ["uno", "del tag", "uno"]


# ----- the ASGI middleware -----


async def call(app, headers: List[Tuple[bytes, bytes]], scope_type: str = "http") -> Optional[str]:
    seen: List[Optional[str]] = []

    async def inner(scope, receive, send):
        seen.append(current_override())

    await PromptOverrideMiddleware(inner)({"type": scope_type, "headers": headers}, None, None)  # type: ignore[arg-type]
    assert current_override() is None  # nothing is left behind
    return seen[0]


@pytest.mark.asyncio
async def test_middleware_hands_the_token_of_the_request_to_the_prompts(monkeypatch):
    monkeypatch.setenv("MEMTRACE_ALLOW_PROMPT_OVERRIDE", "true")
    assert await call(None, [(b"x-memtrace-prompt-override", TOKEN.encode())]) == TOKEN
    assert await call(None, [(b"X-MemTrace-Prompt-Override", TOKEN.encode())]) == TOKEN  # header names are case-insensitive


@pytest.mark.asyncio
async def test_middleware_ignores_junk_and_other_traffic(monkeypatch):
    monkeypatch.setenv("MEMTRACE_ALLOW_PROMPT_OVERRIDE", "true")
    assert await call(None, [(b"x-memtrace-prompt-override", b"not-a-token")]) is None
    assert await call(None, []) is None
    assert await call(None, [(b"x-memtrace-prompt-override", TOKEN.encode())], scope_type="lifespan") is None


@pytest.mark.asyncio
async def test_middleware_is_inert_unless_the_agent_opted_in(monkeypatch):
    monkeypatch.delenv("MEMTRACE_ALLOW_PROMPT_OVERRIDE", raising=False)
    assert await call(None, [(b"x-memtrace-prompt-override", TOKEN.encode())]) is None


@pytest.mark.asyncio
async def test_a_real_http_request_through_the_middleware_runs_the_granted_version(monkeypatch):
    monkeypatch.setenv("MEMTRACE_ALLOW_PROMPT_OVERRIDE", "true")
    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    handle = registry.get("weather-system")

    async def agent(scope, receive, send):
        body = handle.compile().encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": body})

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=PromptOverrideMiddleware(agent)), base_url="http://agent") as client:
        playground = await client.post("/chat", headers={"x-memtrace-prompt-override": TOKEN})
        normal = await client.post("/chat")
    assert (playground.text, normal.text) == ("del override", "del tag")


# ----- the HTTP client -----


def client(handler) -> HttpPromptClient:
    return HttpPromptClient("http://memtrace.test/api/v1/experiments/e1", "mtk_x", transport=httpx.MockTransport(handler))


def test_the_client_asks_memtrace_for_the_version_a_token_grants():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"name": "weather-system", "version": 7, "tag": None, "content": "Hola {{c}}", "variables": ["c"], "contentHash": "h", "archived": False, "playground": True})

    granted = client(handler).fetch_override("weather-system", TOKEN)
    assert granted == PromptVersion("weather-system", 7, "Hola {{c}}", ("c",), "h")
    (request,) = seen
    assert dict(request.url.params) == {"name": "weather-system", "override": TOKEN}
    assert request.headers["authorization"] == "Bearer mtk_x"  # the agent proves who it is; the token proves MemTrace asked


def test_the_client_tells_a_rejected_token_from_an_outage():
    assert client(lambda r: httpx.Response(404, json={"title": "Not Found"})).fetch_override("weather-system", TOKEN) is None
    with pytest.raises(PromptSourceError):
        client(lambda r: httpx.Response(503, json={})).fetch_override("weather-system", TOKEN)


# ----- with a framework that re-evaluates the prompt on each run -----


def test_pydantic_ai_agent_built_once_uses_the_override_only_for_that_run():
    pytest.importorskip("pydantic_ai")
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    registry, source, _ = build()
    source.grants[("weather-system", TOKEN)] = version(7, "del override")
    agent = Agent(TestModel(), instructions=registry.get("weather-system").as_callable())

    def instructions() -> str:
        return [m.instructions for m in agent.run_sync("hola").all_messages() if getattr(m, "instructions", None)][0]

    assert instructions() == "del tag"
    with use_override(TOKEN):
        assert instructions() == "del override"
    assert instructions() == "del tag"
