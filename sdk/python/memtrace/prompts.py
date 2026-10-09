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
from dataclasses import dataclass
from typing import Any, ContextManager, Optional, Sequence

from memtrace.adapters.inbound.asgi import PromptOverrideMiddleware
from memtrace.application.eval_ports import LLMClient
from memtrace.application.prompt_fix import FixCase, FixProposal, FixProposalError, suggest_fix
from memtrace.application.prompt_override import use_override
from memtrace.application.prompt_registry import PromptHandle
from memtrace.dependency_container import get_prompt_registry
from memtrace.domain.prompt import MissingVariableError, PromptError, PromptNotFoundError, PromptUnavailableError

__all__ = [
    "get",
    "aget",
    "override",
    "PromptOverrideMiddleware",
    "FixCase",
    "FixProposal",
    "FixProposalError",
    "suggest_fix",
    "save_draft",
    "propose_fix",
    "Draft",
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


def override(token: Optional[str]) -> ContextManager[None]:
    """Runs a block as if MemTrace's playground had asked for it: `compile()` inside it uses the version `token` grants.

    For frameworks without ASGI (Flask, Django, a queue worker): read the `x-memtrace-prompt-override` header yourself and
    wrap the handling of the request. Needs `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`; otherwise it changes nothing.
    ``with prompts.override(request.headers.get("x-memtrace-prompt-override")): ...``
    """
    return use_override(token)


@dataclass(frozen=True)
class Draft:
    """A draft saved in MemTrace: waiting for a person to review, test and publish it."""

    prompt_id: str
    version: int


def save_draft(
    name: str,
    content: str,
    *,
    rationale: str = "",
    cause: Optional[str] = None,
    trace_ids: Sequence[str] = (),
    message: str = "",
    based_on: Optional[int] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> Draft:
    """Saves `content` as a **draft** of prompt `name` (it must belong to this agent in MemTrace).

    A draft can be tried in the playground and evaluated (ask for it by number with `prompts.get(name, version=N)`), but it
    receives no tag and nothing publishes it by itself: a person reviews it in MemTrace and publishes or discards it.
    Needs `pip install 'memtrace-ai[eval]'`, `MEMTRACE_API_URL` and `MEMTRACE_API_KEY`.
    """
    from memtrace.adapters.outbound.http.prompt_client import HttpPromptClient
    from memtrace.config import settings

    url = base_url or settings.api_url
    if not url:
        raise ValueError("No MemTrace API URL configured; pass base_url= or set MEMTRACE_API_URL")
    client = HttpPromptClient(url, api_key if api_key is not None else settings.api_key, transport=transport)
    try:
        saved = client.save_draft(name, content, message=message, based_on=based_on, trace_ids=trace_ids, cause=cause, rationale=rationale)
    finally:
        client.close()
    return Draft(prompt_id=str(saved["promptId"]), version=int(saved["version"]))


def propose_fix(
    name: str,
    cases: Sequence[FixCase],
    llm: LLMClient,
    *,
    tag: Optional[str] = None,
    version: Optional[int] = None,
    instructions: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    transport: Optional[Any] = None,
) -> Draft:
    """Reads the current version of prompt `name`, asks **your** LLM (`llm`) how to fix `cases`, and saves the result as a draft.

    `cases` are the failures to fix: ``FixCase(input="...", error="...", output="...", trace_id="...")``. `llm` is anything with
    ``complete(system=..., prompt=..., model=...)`` (the same shape as the judges' client, e.g. `AnthropicJudgeClient`):
    MemTrace never sees your provider key, and the cases are sent to the provider you choose. Nothing is published: the
    returned draft has to be reviewed, tested and published by a person. Raises `FixProposalError` if the model's proposal
    would break the agent (it changes the `{{variables}}`, or does not change anything).
    """
    handle = get(name, tag=tag, version=version)
    proposal = suggest_fix(handle.content, cases, llm, instructions=instructions, model=model)
    return save_draft(
        name,
        proposal.content,
        rationale=proposal.rationale,
        cause=next((c.error for c in cases if c.error), None),
        trace_ids=[c.trace_id for c in cases if c.trace_id],
        message="Proposed fix",
        based_on=handle.version if handle.version > 0 else None,
        base_url=base_url,
        api_key=api_key,
        transport=transport,
    )
