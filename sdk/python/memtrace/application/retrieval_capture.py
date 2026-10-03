"""Per-item capture of the chunks a retriever returned, so retrieval metrics can score them (ADR-045).

The chunks already go to the retriever span (`memtrace.retriever.chunks`, ADR-044), but that attribute is
content (opt-in) and lives in the trace backend. Retrieval evaluators need them in-process, right after
`task` returns, and need only ids/sources, so the runner opens a `retrieval_scope()` around each `task`
call and the two ways of reporting chunks (`record_retrieved_chunks`, the LangChain callback) also `note`
them here. Outside a scope everything is a no-op.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, List, Mapping, Optional

_current: ContextVar[Optional[List[Mapping[str, Any]]]] = ContextVar("memtrace_item_retrieved_chunks", default=None)


@contextmanager
def retrieval_scope() -> Iterator[List[Mapping[str, Any]]]:
    """Collects, in call order, the chunks of every retriever call made inside the `with` block."""
    chunks: List[Mapping[str, Any]] = []
    token = _current.set(chunks)
    try:
        yield chunks
    finally:
        _current.reset(token)


def note_retrieved(chunks: List[Mapping[str, Any]]) -> None:
    """Adds one retriever call's normalized chunks to the active scope, if any."""
    collected = _current.get()
    if collected is not None:
        collected.extend(chunks)
