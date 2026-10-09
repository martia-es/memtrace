"""ASGI middleware that lets MemTrace's playground test a prompt version in this agent (ADR-071).

MemTrace calls the agent's chat with the token of a short-lived override in the `x-memtrace-prompt-override` header. This
middleware reads it and, for the duration of that request only, makes `handle.compile()` ask MemTrace for the version the
token grants. It does nothing unless the agent opted in with `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`, and a token MemTrace
does not recognize changes nothing.
"""
from typing import Any, Awaitable, Callable, MutableMapping

from memtrace.application.prompt_override import use_override
from memtrace.config import settings
from memtrace.domain.prompt import PROMPT_OVERRIDE_HEADER, is_override_token

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


class PromptOverrideMiddleware:
    """Pure ASGI (FastAPI, Starlette, Quart…): `app.add_middleware(PromptOverrideMiddleware)`."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app
        self._header = PROMPT_OVERRIDE_HEADER.encode("latin-1")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        token = self._token(scope) if scope.get("type") in ("http", "websocket") and settings.allow_prompt_override else None
        if token is None:
            await self.app(scope, receive, send)
            return
        with use_override(token):
            await self.app(scope, receive, send)

    def _token(self, scope: Scope) -> "str | None":
        for name, value in scope.get("headers") or ():
            if name.lower() == self._header:
                candidate = value.decode("latin-1")
                return candidate if is_override_token(candidate) else None
        return None
