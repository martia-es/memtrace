"""Outbound/inbound ports for offline evaluation: what `run_experiment` needs, agnostic of MemTrace.

Every protocol here is keyword-only and sees only plain values (`Any`, `Optional[Any]`,
`Optional[str]`) — never a MemTrace-specific type. An `Evaluator` written against this
protocol works unchanged against another dataset source, and vice versa (see ADR-027).
"""
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, List, Mapping, Optional, Protocol, Union, runtime_checkable

from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score


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
        """Returns the items to evaluate. Called once per `run_experiment` call.

        A source MAY also expose a `version: Optional[str]` attribute (read after `fetch()`):
        whatever identifies exactly which data it returned. `run_experiment` records it in
        `ExperimentResult.dataset_version` so a result is always traceable to its data.
        """
        ...


class ResultsSink(Protocol):
    def save(self, result: ExperimentResult) -> None:
        """Persists a finished experiment result in one go. Never called if `sink=None`."""
        ...


@runtime_checkable
class IncrementalResultsSink(Protocol):
    """A sink that receives results while the experiment runs, so a crash mid-run loses nothing
    already computed (ADR-034). When a sink has these three methods, `run_experiment` uses them
    instead of `save()`. Items arrive as soon as they finish — NOT in dataset order — each with
    its position in the dataset, so the sink must not assume contiguity."""

    def start(self, *, name: str, dataset_version: Optional[str]) -> None:
        """Called once, before the first item runs. May raise: the experiment then aborts
        without spending a single agent call."""
        ...

    def add(self, index: int, item_result: EvalItemResult) -> None:
        """Called once per finished item, `index` being its position in the dataset. Should not
        raise on transient failures — buffer and retry."""
        ...

    def finish(self, result: ExperimentResult) -> None:
        """Called once after the last item; must flush whatever is still pending."""
        ...


class LLMClient(Protocol):
    """What an LLM-as-judge evaluator needs to ask a model something (see ADR-029).

    Deliberately the smallest possible shape (one text in, one text out) so a judge
    written against it works with any vendor/SDK, not just MemTrace's own adapter.

    A client may optionally expose a `model: str` attribute with the model it uses by default;
    judges record it on their `Score` (ADR-043). Without it, the score's `judge_model` is None
    unless the judge was given an explicit `model=`.
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


class LocalFileDatasetSource:
    """Reads a dataset from a local `.json` (list of rows) or `.jsonl` (one row per line) file.

    Each row is `{"input": ..., "expected_output"?: ..., "metadata"?: ...}` — no MemTrace
    dependency, no network.
    """

    def __init__(self, path: Union[str, Path]):
        self._path = Path(path)
        self.version: Optional[str] = None
        """Content fingerprint (`sha256:<12 hex>`) of the file as last read: the same file content
        always has the same version, so two runs over an edited file are told apart."""

    def fetch(self) -> Iterable[EvalItem]:
        raw = self._path.read_bytes()
        self.version = "sha256:" + hashlib.sha256(raw).hexdigest()[:12]
        text = raw.decode("utf-8")
        if self._path.suffix.lower() == ".jsonl":
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            rows = json.loads(text)
            if not isinstance(rows, list):
                raise ValueError(f"{self._path}: expected a JSON list of rows")
        return InMemoryDatasetSource(rows).fetch()
