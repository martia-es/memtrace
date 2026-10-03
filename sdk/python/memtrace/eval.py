"""Offline evaluation: run your agent against a dataset and score its output.

Runs entirely in your own process (script, notebook, CI job) — MemTrace hosts nothing for
this (see ADR-027, roadmap Fase 1.75). `Evaluator` and the dataset items are plain values,
so nothing here requires MemTrace's API:

    from memtrace.eval import run_experiment, exact_match

    def my_agent(*, item):
        return call_my_agent(item.input)

    result = run_experiment(
        data=[{"input": "2+2?", "expected_output": "4"}],
        task=my_agent,
        evaluators=[exact_match],
        name="smoke-test",
        sink=None,  # keep the result in memory; don't touch MemTrace at all
    )
    print(result.dataset_version, result.summary())  # per-evaluator pass rate / average, computed locally

Other ways to give it data:
  - `data=Path("examples.jsonl")` (or `.json`): a local file, one `{"input", "expected_output"?,
    "metadata"?}` row per line / list element. No MemTrace involved.
  - `data="<dataset_id>"`: pull items from MemTrace's query API (needs the `eval` extra:
    `pip install 'memtrace-ai[eval]'`), latest version by default; add `dataset_version="2.1"` to
    pin one exact version. Results are uploaded back to that same dataset while the experiment runs,
    recorded against the exact version that was read, unless you pass your own `sink`.
"""
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Optional, Sequence, Union

from memtrace.application.eval_ports import (
    DatasetSource,
    Evaluator,
    IncrementalResultsSink,
    LocalFileDatasetSource,
    ResultsSink,
    TaskFunction,
)
from memtrace.application.retrieval_metrics import MRR, HitRate, RecallAtK
from memtrace.application.experiment_runner import ResultsUploadError
from memtrace.application.experiment_runner import run_experiment as _execute_experiment
from memtrace.domain.model import StepType
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score, ScoreSummary

__all__ = [
    "run_experiment",
    "exact_match",
    "contains",
    "RecallAtK",
    "MRR",
    "HitRate",
    "DatasetSource",
    "LocalFileDatasetSource",
    "Evaluator",
    "IncrementalResultsSink",
    "ResultsSink",
    "ResultsUploadError",
    "TaskFunction",
    "EvalItem",
    "EvalItemResult",
    "ExperimentResult",
    "Score",
    "ScoreSummary",
]

_AUTO = object()


def _tracing_item_scope() -> Optional[Any]:
    """One root span (`eval.item`) per item, only when `init_tracer()` already ran: the item's trace id is
    what links the run to its latency, tokens and cost. Nothing is initialized as a side effect."""
    from memtrace.dependency_container import active_service

    service = active_service()
    if service is None:
        return None

    @contextmanager
    def scope(item: EvalItem) -> Iterator[Optional[str]]:
        with service.step("eval.item", StepType.CHAIN):
            yield service.current_trace_id()

    return scope


def run_experiment(
    *,
    data: Union[str, Path, DatasetSource, Iterable[Union[Mapping[str, Any], EvalItem]]],
    task: TaskFunction,
    evaluators: Sequence[Evaluator],
    name: str,
    dataset_version: Optional[str] = None,
    sink: Any = _AUTO,
    max_workers: int = 4,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ExperimentResult:
    """Runs `task` against every item of `data` and scores each output with `evaluators`.

    `data`: a dataset id (`str`, fetched from MemTrace's query API), a `pathlib.Path` to a local
    `.json`/`.jsonl` file, a `DatasetSource`, or a plain iterable of
    `{"input", "expected_output"?, "metadata"?}` dicts / `EvalItem`s — no MemTrace dependency
    except in the dataset-id case.

    `dataset_version`: "major.minor" (e.g. `"2.1"`) of the MemTrace dataset to read; only valid
    when `data` is a dataset id. Omitted, the latest version is used.

    `sink`: where results go. Left at its default, results upload automatically only when
    `data` was a dataset id (to that same dataset's runs) — MemTrace never guesses a
    destination for data it didn't hand you. Pass your own `ResultsSink` (or `IncrementalResultsSink`,
    which receives items as they finish) to upload elsewhere, or `sink=None` to keep the result only
    in memory. If saving fails after the items ran, `ResultsUploadError.result` still holds everything.

    If `init_tracer()` was called before, each item runs inside its own trace (`eval.item` span) and its
    id is stored with the result: the dashboard reads latency, tokens and cost of every item from it.
    Without a tracer those columns stay empty.
    """
    resolved_sink: Optional[ResultsSink] = None if sink is _AUTO else sink
    if dataset_version is not None and not isinstance(data, str):
        raise ValueError("dataset_version only applies when `data` is a MemTrace dataset id")
    if isinstance(data, str):
        from memtrace.adapters.outbound.http.eval_api_client import MemTraceDatasetSource, MemTraceResultsSink

        source: Union[DatasetSource, Iterable[Any]] = MemTraceDatasetSource(data, version=dataset_version, base_url=base_url, api_key=api_key)
        if sink is _AUTO:
            resolved_sink = MemTraceResultsSink(data, version=dataset_version, base_url=base_url, api_key=api_key)
    elif isinstance(data, Path):
        source = LocalFileDatasetSource(data)
    else:
        source = data

    return _execute_experiment(
        data=source,
        task=task,
        evaluators=evaluators,
        name=name,
        sink=resolved_sink,
        max_workers=max_workers,
        item_scope=_tracing_item_scope(),
    )


class _ExactMatch:
    """Scores True if `output == expected_output` (skipped if there's no expectation)."""

    name = "exact_match"

    def __call__(self, *, output: Any, expected_output: Optional[Any]) -> Score:
        if expected_output is None:
            return Score(name=self.name, value=False, data_type="boolean", comment="no expected_output to compare")
        return Score(name=self.name, value=output == expected_output, data_type="boolean")


class _Contains:
    """Scores True if the (stringified) expected output appears in the (stringified) output."""

    name = "contains"

    def __call__(self, *, output: Any, expected_output: Optional[Any]) -> Score:
        if expected_output is None:
            return Score(name=self.name, value=False, data_type="boolean", comment="no expected_output to compare")
        return Score(name=self.name, value=str(expected_output) in str(output), data_type="boolean")


exact_match = _ExactMatch()
contains = _Contains()
