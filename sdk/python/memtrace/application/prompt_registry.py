"""Prompts of the registry, ready to use from an agent (ADR-068).

`PromptRegistry.get()` returns a `PromptHandle`, not text. Agents usually load their prompts once (in a `lifespan`),
and the version has to be decided *when the prompt is used*, so the handle keeps the version it follows and the
agent calls `handle.compile(...)` on every request:

* `compile()` never touches the network: it reads the version already in memory and substitutes the variables.
* A background thread follows the tag (`If-None-Match`, so an unchanged tag costs an empty `304`), so moving `dev`
  to another version reaches the agent without restarting it.
* If MemTrace is down the last known version keeps serving; at startup, a disk cache or `default=` stand in.
* The same thread tells MemTrace which versions this agent is using, so the dashboard shows the real one.
"""
import logging
import os
import threading
import time
import weakref
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from memtrace.application.prompt_ports import Fetched, PromptCache, PromptSource, PromptSourceError, UsageSink, UsedPrompt
from memtrace.domain.prompt import (
    PROMPT_NAME_ATTRIBUTE,
    PROMPT_VERSION_ATTRIBUTE,
    PromptNotFoundError,
    PromptUnavailableError,
    PromptVersion,
    default_tag,
    local_default,
    render,
)

logger = logging.getLogger("memtrace")

_MAX_BACKOFF_SECONDS = 300.0
_USAGE_RETRY_SECONDS = 60.0
_TICK_SECONDS = 1.0

Key = Tuple[str, Optional[str], Optional[int]]  # (name, tag, pinned version)


class PromptHandle:
    """A prompt of the registry that keeps following its tag (or stays on a fixed version).

    Keep it (module level, `lifespan`) and call `compile()` per request.
    """

    def __init__(self, registry: "PromptRegistry", key: Key, current: PromptVersion, etag: Optional[str], next_check: float) -> None:
        self._registry = registry
        self._key = key
        self._current = current
        self._etag = etag
        self._next_check = next_check
        self._failures = 0
        self._warned = False

    @property
    def name(self) -> str:
        return self._key[0]

    @property
    def tag(self) -> Optional[str]:
        """The tag this handle follows; `None` when it is pinned to a version."""
        return self._key[1]

    @property
    def version(self) -> int:
        """Number of the version in use now (0 = the local `default=`, MemTrace was not reachable)."""
        return self._current.version

    @property
    def content(self) -> str:
        """The raw text in use now, with its `{{variables}}`."""
        return self._current.content

    @property
    def variables(self) -> Tuple[str, ...]:
        return self._current.variables

    def compile(self, **values: Any) -> str:
        """The text of the version in use, with `{{name}}` replaced by `str(values[name])`.

        Raises `MissingVariableError` if the prompt uses a variable that is not given. Also stamps the prompt name and
        version on the current span, which is what links a trace to the version that produced it.
        """
        current = self._current  # one read: a refresh in the middle cannot mix two versions
        text = render(current, values)
        self._registry._note_use(current)
        return text

    def as_callable(self, **values: Any) -> Callable[..., str]:
        """A function that returns `compile(**values)` each time it is called, ignoring the arguments it receives.

        For frameworks that take the prompt as a function evaluated on every run instead of as a string (the string
        would freeze the version at the moment the agent was built).
        """

        def prompt(*_args: Any, **_kwargs: Any) -> str:
            return self.compile(**values)

        return prompt

    def refresh(self) -> bool:
        """Checks the registry now. Returns `True` if the version changed."""
        before = self._current.version
        self._registry._refresh(self, force=True)
        return self._current.version != before

    def __repr__(self) -> str:
        follows = f"tag={self.tag!r}" if self.tag else f"version={self._key[2]}"
        return f"<PromptHandle {self.name!r} {follows} -> v{self.version}>"


class PromptRegistry:
    def __init__(
        self,
        source: Optional[PromptSource],
        *,
        usage: Optional[UsageSink] = None,
        cache: Optional[PromptCache] = None,
        annotate: Optional[Callable[[Mapping[str, Any]], None]] = None,
        environment: Optional[str] = None,
        refresh_seconds: float = 30.0,
        usage_seconds: float = 300.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source = source
        self._usage = usage
        self._cache = cache
        self._annotate = annotate
        self._environment = (environment or "").strip().lower() or None
        self._refresh_seconds = max(1.0, refresh_seconds)
        self._usage_seconds = max(1.0, usage_seconds)
        self._clock = clock
        self._handles: Dict[Key, PromptHandle] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._pid = os.getpid()
        self._next_usage = 0.0
        _REGISTRIES.add(self)

    # ----- public -----

    def get(self, name: str, *, tag: Optional[str] = None, version: Optional[int] = None, default: Optional[str] = None) -> PromptHandle:
        """The handle of a prompt, asking MemTrace once (a few seconds at most) so a wrong name fails at startup.

        `tag` or `version`, not both; with neither, it follows the tag named like `MEMTRACE_ENVIRONMENT` (`dev`, `pre`,
        `pro`). `default` is the text to use if MemTrace cannot be reached and there is no disk cache. Asking again for
        the same prompt returns the same handle.
        """
        if tag is not None and version is not None:
            raise ValueError("Pass tag= or version=, not both")
        if version is not None and version < 1:
            raise ValueError("version must be 1 or greater")
        if tag is None and version is None:
            tag = default_tag(self._environment)
        key: Key = (name, tag, version)
        with self._lock:
            existing = self._handles.get(key)
            if existing is not None:
                return existing
            handle = self._open(key, default)
            self._handles[key] = handle
        self._ensure_thread()
        return handle

    def shutdown(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        self._thread = None

    def run_once(self) -> None:
        """One pass of the background work: follow the tags that are due and report usage. The thread calls it every second."""
        now = self._clock()
        with self._lock:
            handles = list(self._handles.values())
        for handle in handles:
            if not self._is_final(handle) and now >= handle._next_check:
                self._refresh(handle)
        if self._usage is not None and now >= self._next_usage:
            self._report_usage(handles)

    # ----- opening -----

    def _open(self, key: Key, default: Optional[str]) -> PromptHandle:
        name, tag, version = key
        now = self._clock()
        if self._source is None:
            initial, etag = self._fallback(key, default, reason="MEMTRACE_API_URL is not set"), None
            return PromptHandle(self, key, initial, etag, now + self._refresh_seconds)
        try:
            fetched = self._source.fetch(name, tag, version, None)
            assert fetched is not None  # without an etag the registry always answers with the version
            if self._cache is not None:
                self._cache.store(name, tag, version, fetched.version)
            return PromptHandle(self, key, fetched.version, fetched.etag, now + self._refresh_seconds)
        except PromptNotFoundError:
            raise
        except PromptSourceError as exc:
            initial = self._fallback(key, default, reason=str(exc))
            # retry soon: the agent should leave the fallback as soon as MemTrace answers
            return PromptHandle(self, key, initial, None, now + min(self._refresh_seconds, 5.0))

    def _fallback(self, key: Key, default: Optional[str], reason: str) -> PromptVersion:
        name, tag, version = key
        cached = self._cache.load(name, tag, version) if self._cache is not None else None
        if cached is not None:
            logger.warning("[MemTrace] Prompt '%s' served from the disk cache (v%s): %s", name, cached.version, reason)
            return cached
        if default is not None:
            logger.warning("[MemTrace] Prompt '%s' using the local default: %s", name, reason)
            return local_default(name, default)
        raise PromptUnavailableError(f"Could not load prompt '{name}' from MemTrace and no default= or cache is set: {reason}")

    # ----- following the tag -----

    @staticmethod
    def _is_final(handle: PromptHandle) -> bool:
        """A pinned version never changes: once we hold the real one there is nothing to follow."""
        return handle._key[2] is not None and handle._current.from_registry

    def _refresh(self, handle: PromptHandle, force: bool = False) -> None:
        if self._source is None:
            return
        name, tag, version = handle._key
        try:
            fetched: Optional[Fetched] = self._source.fetch(name, tag, version, None if force else handle._etag)
        except PromptNotFoundError as exc:
            self._failed(handle, f"{exc} (keeping v{handle._current.version})")
            return
        except PromptSourceError as exc:
            self._failed(handle, f"{exc} (keeping v{handle._current.version})")
            return
        handle._failures = 0
        handle._warned = False
        handle._next_check = self._clock() + self._refresh_seconds
        if fetched is None:
            return
        previous = handle._current.version
        handle._current = fetched.version
        handle._etag = fetched.etag
        if self._cache is not None:
            self._cache.store(name, tag, version, fetched.version)
        if previous != fetched.version.version:
            logger.info("[MemTrace] Prompt '%s' %s moved from v%s to v%s", name, f"tag '{tag}'" if tag else "", previous, fetched.version.version)
            self._next_usage = 0.0  # tell MemTrace soon

    def _failed(self, handle: PromptHandle, message: str) -> None:
        handle._failures += 1
        backoff = min(self._refresh_seconds * (2 ** handle._failures), _MAX_BACKOFF_SECONDS)
        handle._next_check = self._clock() + backoff
        if not handle._warned:  # once per streak: a long outage must not flood the log
            logger.warning("[MemTrace] Could not refresh prompt '%s': %s", handle.name, message)
            handle._warned = True

    # ----- using it -----

    def _note_use(self, version: PromptVersion) -> None:
        if self._annotate is None or not version.from_registry:
            return
        try:
            self._annotate({PROMPT_NAME_ATTRIBUTE: version.name, PROMPT_VERSION_ATTRIBUTE: version.version})
        except Exception as exc:  # instrumentation never breaks the agent
            logger.debug("[MemTrace] Could not stamp the prompt on the span: %s", exc)

    def _report_usage(self, handles: List[PromptHandle]) -> None:
        items = [UsedPrompt(h.name, h.tag, h._current.version) for h in handles if h._current.from_registry]
        if not items:
            self._next_usage = self._clock() + self._usage_seconds
            return
        try:
            assert self._usage is not None
            self._usage.report(self._environment, items)
            self._next_usage = self._clock() + self._usage_seconds
        except PromptSourceError as exc:
            self._next_usage = self._clock() + min(_USAGE_RETRY_SECONDS, self._usage_seconds)
            logger.debug("[MemTrace] Could not report prompt usage: %s", exc)

    # ----- thread -----

    def _ensure_thread(self) -> None:
        if self._source is None:
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive() and self._pid == os.getpid():
                return
            self._stop = threading.Event()
            self._pid = os.getpid()
            self._thread = threading.Thread(target=self._loop, args=(self._stop,), name="memtrace-prompts", daemon=True)
            self._thread.start()

    def _loop(self, stop: threading.Event) -> None:
        while not stop.wait(min(_TICK_SECONDS, self._refresh_seconds)):
            try:
                self.run_once()
            except Exception as exc:  # the thread must survive anything
                logger.debug("[MemTrace] Prompt refresh pass failed: %s", exc, exc_info=True)

    def _after_fork_in_child(self) -> None:
        # threads do not survive a fork (gunicorn --preload, multiprocessing): the child starts its own on first use
        self._lock = threading.RLock()
        self._thread = None
        self._stop = threading.Event()
        self._next_usage = 0.0
        if self._handles:
            self._ensure_thread()


_REGISTRIES: "weakref.WeakSet[PromptRegistry]" = weakref.WeakSet()


def _reset_after_fork() -> None:
    for registry in list(_REGISTRIES):
        registry._after_fork_in_child()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset_after_fork)
