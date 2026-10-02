"""Outbound/inbound ports for offline evaluation: what `run_experiment` needs, agnostic of MemTrace.

Every protocol here is keyword-only and sees only plain values (`Any`, `Optional[Any]`,
`Optional[str]`) — never a MemTrace-specific type. An `Evaluator` written against this
protocol works unchanged against another dataset source, and vice versa (see ADR-027).
"""
from typing import Any, Iterable, List, Mapping, Optional, Protocol, Union, runtime_checkable

from memtrace.domain.evaluation import EvalItem, ExperimentResult, Score


class TaskFunction(Protocol):
    def __call__(self, *, item: EvalItem) -> Any:
        """Runs the user's agent on one item and returns its raw output."""
        ...


class Evaluator(Protocol):
    """A scoring function. Only `name` is required; give it whatever signature you need —
    `run_experiment` passes `input`/`output`/`expected_output`/`metadata`/`trace_id` by keyword
    and only the ones your `__call__` declares are required."""

    name: str

    def __call__(
        self,
        *,
        input: Any,
        output: Any,
        expected_output: Optional[Any],
        metadata: Optional[Mapping[str, Any]],
        trace_id: Optional[str],
    ) -> Union[Score, List[Score]]: ...


@runtime_checkable
class DatasetSource(Protocol):
    def fetch(self) -> Iterable[EvalItem]:
        """Returns the items to evaluate. Called once per `run_experiment` call."""
        ...


class ResultsSink(Protocol):
    def save(self, result: ExperimentResult) -> None:
        """Persists a finished experiment result. Never called if `sink=None`."""
        ...


class LLMClient(Protocol):
    """What an LLM-as-judge evaluator needs to ask a model something (see ADR-029).

    Deliberately the smallest possible shape (one text in, one text out) so a judge
    written against it works with any vendor/SDK, not just MemTrace's own adapter.
    """

    def complete(self, *, system: str, prompt: str, model: Optional[str] = None) -> str:
        """Sends one request and returns the model's raw text reply."""
        ...


class InMemoryDatasetSource:
    """Wraps data the caller already has (no MemTrace dependency) into a `DatasetSource`."""

    def __init__(self, items: Iterable[Union[Mapping[str, Any], EvalItem]]):
        self._items = list(items)

    def fetch(self) -> Iterable[EvalItem]:
        for item in self._items:
            if isinstance(item, EvalItem):
                yield item
            else:
                yield EvalItem(
                    input=item["input"],
                    expected_output=item.get("expected_output"),
                    metadata=item.get("metadata"),
                )
