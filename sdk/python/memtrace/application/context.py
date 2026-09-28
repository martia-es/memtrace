"""Per-execution-context state (thread / asyncio task)."""
import contextvars
import uuid
from contextlib import contextmanager
from typing import Iterator, Optional

current_run_id: contextvars.ContextVar[Optional[uuid.UUID]] = contextvars.ContextVar(
    "memtrace_current_run_id", default=None
)
_session_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "memtrace_session_id", default=None
)


def get_current_run_id() -> Optional[uuid.UUID]:
    return current_run_id.get()


def get_session_id() -> Optional[str]:
    return _session_id.get()


@contextmanager
def session(session_id: str) -> Iterator[None]:
    """Groups the spans created in the block under one conversation (`gen_ai.conversation.id`)."""
    token = _session_id.set(session_id)
    try:
        yield
    finally:
        _session_id.reset(token)
