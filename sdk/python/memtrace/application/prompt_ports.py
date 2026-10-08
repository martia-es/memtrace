"""Outbound ports of the prompt registry (ADR-068)."""
from dataclasses import dataclass
from typing import Optional, Protocol, Sequence

from memtrace.domain.prompt import PromptVersion


class PromptSourceError(Exception):
    """The registry could not be reached or answered with a server error. Transient: the last known version keeps serving."""


@dataclass(frozen=True)
class Fetched:
    version: PromptVersion
    etag: Optional[str]


# `None` returned by `fetch` means "not modified": the version the caller already has is still the right one.
class PromptSource(Protocol):
    def fetch(self, name: str, tag: Optional[str], version: Optional[int], etag: Optional[str]) -> Optional[Fetched]:
        """Asks for a prompt by tag or by version.

        Raises `PromptNotFoundError` when it does not exist for this agent, `PromptSourceError` on transient failures.
        """


@dataclass(frozen=True)
class UsedPrompt:
    name: str
    tag: Optional[str]
    version: int


class UsageSink(Protocol):
    def report(self, environment: Optional[str], items: Sequence[UsedPrompt]) -> None:
        """Tells MemTrace which versions this agent is using. Raises `PromptSourceError` on transient failures."""


class PromptCache(Protocol):
    """Last known version of each (prompt, tag/version) on disk, so an agent can start while MemTrace is down."""

    def load(self, name: str, tag: Optional[str], version: Optional[int]) -> Optional[PromptVersion]: ...

    def store(self, name: str, tag: Optional[str], version: Optional[int], value: PromptVersion) -> None: ...
