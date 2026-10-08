"""The prompt registry from the agent's side (ADR-068): a handle that is compiled per request without touching the network."""
import logging
import time
from typing import Dict, List, Optional, Sequence, Tuple

import pytest

from memtrace.application.prompt_ports import Fetched, PromptSourceError, UsedPrompt
from memtrace.application.prompt_registry import PromptRegistry
from memtrace.domain.prompt import (
    MissingVariableError,
    PromptNotFoundError,
    PromptUnavailableError,
    PromptVersion,
    extract_variables,
    local_default,
    render,
)


def version(n: int, content: str, name: str = "weather-system") -> PromptVersion:
    return PromptVersion(name=name, version=n, content=content, variables=extract_variables(content), content_hash=f"h{n}")


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeSource:
    """In-memory registry: tags point to versions; ETags make an unchanged answer a 304 like the real API."""

    def __init__(self) -> None:
        self.versions: Dict[Tuple[str, int], PromptVersion] = {}
        self.tags: Dict[Tuple[str, str], int] = {}
        self.calls: List[Tuple[str, Optional[str], Optional[int], Optional[str]]] = []
        self.fail: Optional[Exception] = None
        self.reports: List[Tuple[Optional[str], Sequence[UsedPrompt]]] = []
        self.report_fails = False

    def publish(self, n: int, content: str, tag: Optional[str] = None, name: str = "weather-system") -> None:
        self.versions[(name, n)] = version(n, content, name)
        if tag:
            self.tags[(name, tag)] = n

    def fetch(self, name, tag, version_number, etag):
        self.calls.append((name, tag, version_number, etag))
        if self.fail is not None:
            raise self.fail
        n = version_number if version_number is not None else self.tags.get((name, tag))
        found = self.versions.get((name, n)) if n is not None else None
        if found is None:
            raise PromptNotFoundError(f"Prompt '{name}' not found for this agent")
        current = f'"v{found.version}"'
        return None if etag == current else Fetched(found, current)

    def report(self, environment, items):
        if self.report_fails:
            raise PromptSourceError("down")
        self.reports.append((environment, list(items)))


class MemoryCache:
    def __init__(self) -> None:
        self.data: Dict[Tuple[str, Optional[str], Optional[int]], PromptVersion] = {}

    def load(self, name, tag, version_number):
        return self.data.get((name, tag, version_number))

    def store(self, name, tag, version_number, value):
        self.data[(name, tag, version_number)] = value


def build(source: Optional[FakeSource] = None, **kwargs):
    source = source if source is not None else FakeSource()
    clock = FakeClock()
    stamps: List[dict] = []
    options = dict(usage=source, annotate=stamps.append, environment="dev", refresh_seconds=30, usage_seconds=300, clock=clock)
    options.update(kwargs)
    registry = PromptRegistry(source, **options)
    return registry, source, clock, stamps


@pytest.fixture(autouse=True)
def _stop_threads():
    registries = []
    original = PromptRegistry.__init__

    def tracking(self, *args, **kwargs):
        original(self, *args, **kwargs)
        registries.append(self)

    PromptRegistry.__init__ = tracking
    yield
    PromptRegistry.__init__ = original
    for registry in registries:
        registry.shutdown()


# ----- rendering -----


def test_render_substitutes_variables_with_or_without_spaces_and_ignores_extras():
    v = version(1, "Hola {{ nombre }}, hoy en {{ciudad}} hace sol. {{nombre}}")
    assert render(v, {"nombre": "Ana", "ciudad": "Sevilla", "sobra": 1}) == "Hola Ana, hoy en Sevilla hace sol. Ana"


def test_render_inserts_text_and_never_expands_a_value_again():
    v = version(1, "Dijo: {{x}}")
    assert render(v, {"x": "{{y}}"}) == "Dijo: {{y}}"
    assert render(version(1, "n={{n}}"), {"n": 3}) == "n=3"


def test_render_reports_every_missing_variable_at_once():
    with pytest.raises(MissingVariableError) as caught:
        render(version(1, "{{a}} {{b}} {{c}}"), {"b": 1})
    assert caught.value.missing == ("a", "c")
    assert "a, c" in str(caught.value)


def test_text_without_variables_renders_as_is():
    assert render(version(1, "Eres breve."), {}) == "Eres breve."


# ----- get() -----


def test_follows_the_tag_named_like_the_environment_by_default():
    registry, source, _, _ = build(environment="pro")
    source.publish(2, "pro text", tag="pro")
    handle = registry.get("weather-system")
    assert (handle.tag, handle.version, handle.content) == ("pro", 2, "pro text")


def test_without_tag_version_or_environment_it_asks_for_one():
    registry, _, _, _ = build(environment=None)
    with pytest.raises(ValueError, match="MEMTRACE_ENVIRONMENT"):
        registry.get("weather-system")


def test_tag_and_version_together_are_rejected():
    registry, _, _, _ = build()
    with pytest.raises(ValueError):
        registry.get("weather-system", tag="dev", version=1)
    with pytest.raises(ValueError):
        registry.get("weather-system", version=0)


def test_asking_for_the_same_prompt_twice_returns_the_same_handle_and_asks_the_registry_once():
    registry, source, _, _ = build()
    source.publish(1, "uno", tag="dev")
    assert registry.get("weather-system", tag="dev") is registry.get("weather-system", tag="dev")
    assert len(source.calls) == 1


def test_a_missing_prompt_fails_at_startup_even_with_a_default():
    registry, source, _, _ = build()
    with pytest.raises(PromptNotFoundError):
        registry.get("weather-system", tag="dev", default="local")
    assert source.calls  # it did ask


# ----- compile() is memory only -----


def test_compile_never_calls_the_registry():
    registry, source, _, _ = build()
    source.publish(1, "Hola {{n}}", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    calls = len(source.calls)
    for i in range(1000):
        assert handle.compile(n=i) == f"Hola {i}"
    assert len(source.calls) == calls


def test_compile_stamps_name_and_version_on_the_current_span():
    registry, source, _, stamps = build()
    source.publish(3, "x", tag="dev")
    registry.get("weather-system", tag="dev").compile()
    assert stamps == [{"memtrace.prompt.name": "weather-system", "memtrace.prompt.version": 3}]


def test_a_failure_stamping_the_span_never_reaches_the_agent():
    def broken(_attributes):
        raise RuntimeError("tracer exploded")

    registry, source, _, _ = build(annotate=broken)
    source.publish(1, "ok", tag="dev")
    assert registry.get("weather-system", tag="dev").compile() == "ok"


def test_as_callable_returns_the_current_text_every_time_and_ignores_the_arguments_it_gets():
    registry, source, clock, _ = build()
    source.publish(1, "Ciudad: {{c}}", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    instructions = handle.as_callable(c="Sevilla")
    assert instructions() == "Ciudad: Sevilla"
    source.publish(2, "Nueva ciudad: {{c}}", tag="dev")
    clock.advance(31)
    registry.run_once()
    assert instructions("ctx", extra=1) == "Nueva ciudad: Sevilla"


# ----- following the tag -----


def test_moving_the_tag_reaches_the_handle_without_restarting_the_agent():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    source.publish(2, "dos", tag="dev")
    registry.run_once()
    assert handle.version == 1  # not due yet: the registry is not asked more than every refresh_seconds
    clock.advance(31)
    registry.run_once()
    assert (handle.version, handle.compile()) == (2, "dos")


def test_an_unchanged_tag_costs_an_empty_answer_and_keeps_the_handle():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    clock.advance(31)
    registry.run_once()
    assert source.calls[-1][3] == '"v1"'  # it sent If-None-Match
    assert handle.version == 1


def test_a_version_pinned_by_number_is_never_refreshed():
    registry, source, clock, _ = build()
    source.publish(1, "uno")
    handle = registry.get("weather-system", version=1)
    calls = len(source.calls)
    clock.advance(10_000)
    registry.run_once()
    assert len(source.calls) == calls
    assert handle.tag is None and handle.version == 1


def test_a_refresh_that_fails_keeps_serving_the_last_version_and_warns_once(caplog):
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    source.fail = PromptSourceError("connection refused")
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        for _ in range(4):
            clock.advance(10_000)
            registry.run_once()
    assert handle.compile() == "uno"
    assert len([r for r in caplog.records if "Could not refresh" in r.getMessage()]) == 1


def test_failed_refreshes_back_off_instead_of_hammering_a_down_registry():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    registry.get("weather-system", tag="dev")
    source.fail = PromptSourceError("down")
    clock.advance(31)
    registry.run_once()
    calls = len(source.calls)
    clock.advance(31)  # less than the backoff after the first failure
    registry.run_once()
    assert len(source.calls) == calls


def test_it_recovers_by_itself_when_the_registry_comes_back():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    source.fail = PromptSourceError("down")
    clock.advance(31)
    registry.run_once()
    source.fail = None
    source.publish(2, "dos", tag="dev")
    clock.advance(1000)
    registry.run_once()
    assert handle.version == 2


def test_a_tag_that_stops_existing_keeps_the_last_version(caplog):
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    del source.tags[("weather-system", "dev")]
    clock.advance(31)
    with caplog.at_level(logging.WARNING, logger="memtrace"):
        registry.run_once()
    assert handle.compile() == "uno"
    assert any("not found" in r.getMessage() for r in caplog.records)


# ----- MemTrace unreachable at startup -----


def test_startup_without_memtrace_and_without_fallback_fails_clearly():
    registry, source, _, _ = build()
    source.fail = PromptSourceError("connection refused")
    with pytest.raises(PromptUnavailableError, match="connection refused"):
        registry.get("weather-system", tag="dev")


def test_startup_without_memtrace_uses_the_default_then_switches_to_the_real_version():
    registry, source, clock, stamps = build()
    source.fail = PromptSourceError("connection refused")
    handle = registry.get("weather-system", tag="dev", default="Texto local {{x}}")
    assert (handle.version, handle.compile(x=1)) == (0, "Texto local 1")
    assert stamps == []  # the default is not a registry version: nothing to link a trace to
    source.fail = None
    source.publish(4, "Real {{x}}", tag="dev")
    clock.advance(6)  # the first retry comes soon
    registry.run_once()
    assert (handle.version, handle.compile(x=1)) == (4, "Real 1")
    assert stamps[-1]["memtrace.prompt.version"] == 4


def test_startup_without_memtrace_prefers_the_disk_cache_to_the_default():
    cache = MemoryCache()
    cache.store("weather-system", "dev", None, version(7, "cacheado"))
    registry, source, _, _ = build(cache=cache)
    source.fail = PromptSourceError("down")
    handle = registry.get("weather-system", tag="dev", default="local")
    assert (handle.version, handle.content) == (7, "cacheado")


def test_every_version_served_is_written_to_the_cache():
    cache = MemoryCache()
    registry, source, clock, _ = build(cache=cache)
    source.publish(1, "uno", tag="dev")
    registry.get("weather-system", tag="dev")
    source.publish(2, "dos", tag="dev")
    clock.advance(31)
    registry.run_once()
    assert cache.load("weather-system", "dev", None).version == 2


def test_without_an_api_url_it_works_offline_with_the_default():
    registry = PromptRegistry(None, environment="dev")
    handle = registry.get("weather-system", default="Solo local {{x}}")
    assert handle.compile(x="ok") == "Solo local ok"
    with pytest.raises(PromptUnavailableError):
        registry.get("otro")


# ----- usage report -----


def test_it_tells_memtrace_which_versions_the_agent_uses_and_repeats_it_periodically():
    registry, source, clock, _ = build(environment="pro")
    source.publish(2, "dos", tag="pro")
    registry.get("weather-system")
    registry.run_once()
    assert source.reports == [("pro", [UsedPrompt("weather-system", "pro", 2)])]
    registry.run_once()
    assert len(source.reports) == 1  # not again until usage_seconds
    clock.advance(301)
    registry.run_once()
    assert len(source.reports) == 2


def test_a_pinned_version_is_reported_without_a_tag():
    registry, source, _, _ = build()
    source.publish(1, "uno")
    registry.get("weather-system", version=1)
    registry.run_once()
    assert source.reports[0][1] == [UsedPrompt("weather-system", None, 1)]


def test_a_moved_tag_is_reported_right_away_not_at_the_next_period():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    registry.get("weather-system", tag="dev")
    registry.run_once()
    source.publish(2, "dos", tag="dev")
    clock.advance(31)
    registry.run_once()
    assert [r[1][0].version for r in source.reports] == [1, 2]


def test_the_local_default_is_not_reported_as_a_version_in_use():
    registry, source, _, _ = build()
    source.fail = PromptSourceError("down")
    registry.get("weather-system", tag="dev", default="local")
    source.fail = None
    registry.run_once()
    assert source.reports == []


def test_a_failed_report_is_retried_soon_and_never_raises():
    registry, source, clock, _ = build()
    source.publish(1, "uno", tag="dev")
    registry.get("weather-system", tag="dev")
    source.report_fails = True
    registry.run_once()
    source.report_fails = False
    clock.advance(61)
    registry.run_once()
    assert len(source.reports) == 1


# ----- thread -----


def test_the_background_thread_starts_with_the_first_prompt_and_stops_on_shutdown():
    registry, source, _, _ = build()
    source.publish(1, "uno", tag="dev")
    assert registry._thread is None
    registry.get("weather-system", tag="dev")
    thread = registry._thread
    assert thread is not None and thread.is_alive() and thread.daemon
    registry.shutdown()
    assert not thread.is_alive()


def test_a_forked_child_gets_its_own_thread():
    registry, source, _, _ = build()
    source.publish(1, "uno", tag="dev")
    registry.get("weather-system", tag="dev")
    parent_thread = registry._thread
    registry._after_fork_in_child()  # what os.register_at_fork runs in the child: threads do not survive a fork
    assert registry._thread is not parent_thread
    assert registry._thread is not None and registry._thread.is_alive()


def test_the_loop_actually_follows_the_tag_in_real_time():
    source = FakeSource()
    source.publish(1, "uno", tag="dev")
    registry = PromptRegistry(source, environment="dev", refresh_seconds=1, usage_seconds=1)  # real clock
    handle = registry.get("weather-system", tag="dev")
    source.publish(2, "dos", tag="dev")
    deadline = time.monotonic() + 5
    while handle.version != 2 and time.monotonic() < deadline:
        time.sleep(0.05)
    assert handle.version == 2


def test_refresh_now_checks_the_registry_immediately():
    registry, source, _, _ = build()
    source.publish(1, "uno", tag="dev")
    handle = registry.get("weather-system", tag="dev")
    assert handle.refresh() is False
    source.publish(2, "dos", tag="dev")
    assert handle.refresh() is True and handle.version == 2


def test_local_default_has_version_zero_and_detects_variables():
    d = local_default("x", "hola {{a}}")
    assert (d.version, d.variables, d.from_registry) == (0, ("a",), False)
