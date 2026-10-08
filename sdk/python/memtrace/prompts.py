"""Prompts of the MemTrace registry, versioned and tagged per environment (ADR-067, ADR-068).

Load them once (module level or `lifespan`) and compile them on every request::

    from memtrace import prompts

    weather = prompts.get("weather-system")            # follows the tag named like MEMTRACE_ENVIRONMENT (dev, pre, pro)
    ...
    system = weather.compile(city=city)                # per request: in memory, no network

`get()` returns a handle, not text, so moving the tag in MemTrace changes what the agent uses within seconds, without
restarting it. Each `compile()` also stamps the prompt name and version on the current span, which links the trace to
the version that produced it. Needs `pip install 'memtrace-ai[eval]'`, `MEMTRACE_API_URL` (with the experiment id) and
`MEMTRACE_API_KEY`; the prompt must belong to that agent in MemTrace.
"""
import asyncio
from typing import Optional

from memtrace.application.prompt_registry import PromptHandle
from memtrace.dependency_container import get_prompt_registry
from memtrace.domain.prompt import MissingVariableError, PromptError, PromptNotFoundError, PromptUnavailableError

__all__ = [
    "get",
    "aget",
    "PromptHandle",
    "PromptError",
    "PromptNotFoundError",
    "PromptUnavailableError",
    "MissingVariableError",
]


def get(name: str, *, tag: Optional[str] = None, version: Optional[int] = None, default: Optional[str] = None) -> PromptHandle:
    """The handle of prompt `name`, loaded now so a mistake fails at startup (it waits a few seconds at most).

    `tag` or `version`, not both. With neither, it follows the tag named like `MEMTRACE_ENVIRONMENT`. A `version` is
    fixed forever; a `tag` is followed: when it moves in MemTrace the handle switches on its own.

    `default` is the text to use if MemTrace cannot be reached and no disk cache exists (`MEMTRACE_PROMPT_CACHE_DIR`);
    the handle leaves it as soon as MemTrace answers. Without a default, that situation raises
    `PromptUnavailableError`. A prompt, tag or version that does not exist always raises `PromptNotFoundError`.
    """
    return get_prompt_registry().get(name, tag=tag, version=version, default=default)


async def aget(name: str, *, tag: Optional[str] = None, version: Optional[int] = None, default: Optional[str] = None) -> PromptHandle:
    """`get()` for async code (a FastAPI `lifespan`): the wait for MemTrace happens in a thread, not in the event loop."""
    return await asyncio.to_thread(get, name, tag=tag, version=version, default=default)
