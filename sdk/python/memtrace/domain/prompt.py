"""Prompt registry concepts (ADR-067, ADR-068). Pure: no HTTP, no threads, no OTel."""
import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

# `{{name}}` or `{{ name }}`; the same rule the API uses to detect variables when a version is saved.
_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

# Span attributes that link a trace to the prompt version it used (columns PromptName / PromptVersion in ClickHouse).
PROMPT_NAME_ATTRIBUTE = "memtrace.prompt.name"
PROMPT_VERSION_ATTRIBUTE = "memtrace.prompt.version"
# Written on the span when the prompt came from a playground override instead of the tag (ADR-071).
PLAYGROUND_ATTRIBUTE = "memtrace.playground"
# Header with which MemTrace hands the agent the token of a playground override (ADR-071).
PROMPT_OVERRIDE_HEADER = "x-memtrace-prompt-override"
_TOKEN = re.compile(r"^mto_[A-Za-z0-9_-]{10,200}$")


def is_override_token(value: Optional[str]) -> bool:
    """Does `value` look like a playground token? Anything else in the header is ignored, never sent anywhere."""
    return bool(value) and bool(_TOKEN.match(value or ""))


class PromptError(Exception):
    """Base class of the errors of the prompt registry."""


class PromptNotFoundError(PromptError):
    """The prompt, tag or version does not exist for this agent. A configuration mistake: it is never hidden."""


class PromptUnavailableError(PromptError):
    """MemTrace could not be reached and there is nothing to fall back to (no cache, no `default=`)."""


class MissingVariableError(PromptError, KeyError):
    """`compile()` was called without some variable the prompt uses."""

    def __init__(self, prompt: str, missing: Tuple[str, ...]) -> None:
        self.prompt = prompt
        self.missing = missing
        super().__init__(f"Prompt '{prompt}' needs the variable(s): {', '.join(missing)}")

    def __str__(self) -> str:  # KeyError would quote the message
        return self.args[0]


@dataclass(frozen=True)
class PromptVersion:
    """One immutable version of a prompt, as the registry serves it.

    `version == 0` means *not from the registry*: the local `default=` the agent passed because MemTrace was not
    reachable. Such a version is never stamped on spans nor reported as used.
    """

    name: str
    version: int
    content: str
    variables: Tuple[str, ...] = ()
    content_hash: str = ""
    archived: bool = False
    # A proposal waiting for review (ADR-072): it can be evaluated by number but must not run in production.
    draft: bool = False

    @property
    def from_registry(self) -> bool:
        return self.version > 0


def local_default(name: str, content: str) -> PromptVersion:
    return PromptVersion(name=name, version=0, content=content, variables=extract_variables(content))


def extract_variables(content: str) -> Tuple[str, ...]:
    seen = []
    for match in _VARIABLE.finditer(content):
        if match.group(1) not in seen:
            seen.append(match.group(1))
    return tuple(seen)


def render(version: PromptVersion, values: Mapping[str, Any]) -> str:
    """Substitutes `{{name}}` with `str(values[name])`. Extra values are ignored; a missing one is an error.

    Nothing is evaluated: values are inserted as text, so a value containing `{{other}}` is not expanded again.
    """
    missing = tuple(name for name in version.variables if name not in values)
    if missing:
        raise MissingVariableError(version.name, missing)
    return _VARIABLE.sub(lambda match: str(values[match.group(1)]), version.content)


def default_tag(environment: Optional[str]) -> str:
    """The tag followed when the agent does not name one: the one called like its environment (`dev`, `pre`, `pro`)."""
    tag = (environment or "").strip().lower()
    if not tag:
        raise ValueError("Pass tag= or version=, or set MEMTRACE_ENVIRONMENT so the prompt follows the tag of that environment")
    return tag
