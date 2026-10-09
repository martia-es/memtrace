"""The playground override of the request being served (ADR-071).

MemTrace tests a prompt version in the real agent by calling its chat with a short-lived token. The web layer of the agent
(`PromptOverrideMiddleware`, or `prompts.override(token)` in other frameworks) puts the token here for the duration of the
request, and `handle.compile()` asks the registry for the version that token grants, only for the prompt it was issued for.
Context variables follow `await`s and the threads frameworks copy the context into, so concurrent requests never see
each other's token.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

_token: ContextVar[Optional[str]] = ContextVar("memtrace_prompt_override", default=None)


def current_override() -> Optional[str]:
    return _token.get()


@contextmanager
def use_override(token: Optional[str]) -> Iterator[None]:
    """Makes `token` the override of everything run inside the block (`None` = no override)."""
    reset = _token.set(token)
    try:
        yield
    finally:
        _token.reset(reset)
