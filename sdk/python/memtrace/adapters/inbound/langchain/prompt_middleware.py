"""Gives a registry prompt to a LangChain agent without freezing its version (ADR-068).

`create_agent(system_prompt="...")` takes a string, so a prompt compiled when the agent is built would stay on the
version it had at that moment. LangChain's middleware runs on every model call, which is where the version has to be
decided: `prompt_middleware(handle)` replaces the system message with `handle.compile(...)` each time.
"""
from typing import Any, Callable, Mapping

from memtrace.application.prompt_registry import PromptHandle


def prompt_middleware(handle: PromptHandle, **variables: Any) -> Any:
    """Middleware for `create_agent(..., middleware=[...])` that uses `handle` as the agent's system prompt.

    Every model call asks the handle for the version in use at that moment (in memory, no network), so moving the tag
    in MemTrace changes the agent without rebuilding it. The trace is linked to the version used (the prompt name and
    version are written on the current span).

    `variables` fill the `{{placeholders}}` of the prompt. A value that is a function is called on every model call with
    LangChain's `ModelRequest` (`request.state`, `request.runtime.context`…) and its result is used::

        agent = create_agent(
            model,
            tools,
            middleware=[prompt_middleware(weather, city=lambda request: request.runtime.context["city"], tone="friendly")],
        )

    It *replaces* the system message: do not also pass `system_prompt=` to `create_agent`.
    Needs `langchain>=1.0` (`pip install langchain`).
    """
    try:
        from langchain.agents.middleware import dynamic_prompt
    except ImportError as exc:
        raise ImportError("prompt_middleware needs langchain>=1.0: pip install 'langchain>=1.0'") from exc

    def resolve(request: Any) -> str:
        return handle.compile(**_values(variables, request))

    # LangChain names a middleware after its function and refuses two with the same name in one agent
    resolve.__name__ = "memtrace_prompt_" + "".join(c if c.isalnum() else "_" for c in handle.name)
    return dynamic_prompt(resolve)


def _values(variables: Mapping[str, Any], request: Any) -> Mapping[str, Any]:
    return {name: value(request) if isinstance(value, Callable) else value for name, value in variables.items()}  # type: ignore[arg-type]
