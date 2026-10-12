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
_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "memtrace_user_id", default=None
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


def get_user_id() -> Optional[str]:
    return _user_id.get()


@contextmanager
def user(user_id: str) -> Iterator[None]:
    """Attributes the spans created in the block to one end user (`enduser.id`), to see cost per user."""
    token = _user_id.set(user_id)
    try:
        yield
    finally:
        _user_id.reset(token)
