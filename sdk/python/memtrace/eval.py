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

Pass `data="<dataset_id>"` instead of a local list to pull items from MemTrace's query API
(needs the `eval` extra: `pip install 'memtrace-ai[eval]'`) — in that case results are
uploaded back to that same dataset automatically unless you pass your own `sink`.
"""
from typing import Any, Iterable, Mapping, Optional, Sequence, Union

from memtrace.application.eval_ports import DatasetSource, Evaluator, ResultsSink, TaskFunction
from memtrace.application.experiment_runner import run_experiment as _execute_experiment
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score

__all__ = [
    "run_experiment",
    "exact_match",
    "contains",
    "DatasetSource",
    "Evaluator",
    "ResultsSink",
    "TaskFunction",
    "EvalItem",
    "EvalItemResult",
    "ExperimentResult",
    "Score",
]

_AUTO = object()


def run_experiment(
    *,
    data: Union[str, DatasetSource, Iterable[Union[Mapping[str, Any], EvalItem]]],
    task: TaskFunction,
    evaluators: Sequence[Evaluator],
    name: str,
    sink: Any = _AUTO,
    max_workers: int = 4,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ExperimentResult:
    """Runs `task` against every item of `data` and scores each output with `evaluators`.

    `data`: a dataset id (`str`, fetched from MemTrace's query API), a `DatasetSource`, or a
    plain iterable of `{"input", "expected_output"?, "metadata"?}` dicts / `EvalItem`s — no
    MemTrace dependency in the last two cases.

    `sink`: where results go. Left at its default, results upload automatically only when
    `data` was a dataset id (to that same dataset's runs) — MemTrace never guesses a
    destination for data it didn't hand you. Pass your own `ResultsSink` to upload elsewhere,
    or `sink=None` to keep the result only in memory.
    """
    resolved_sink: Optional[ResultsSink] = None if sink is _AUTO else sink
    if isinstance(data, str):
        from memtrace.adapters.outbound.http.eval_api_client import MemTraceDatasetSource, MemTraceResultsSink

        source: Union[DatasetSource, Iterable[Any]] = MemTraceDatasetSource(data, base_url=base_url, api_key=api_key)
        if sink is _AUTO:
            resolved_sink = MemTraceResultsSink(data, base_url=base_url, api_key=api_key)
    else:
        source = data

    return _execute_experiment(
        data=source,
        task=task,
        evaluators=evaluators,
        name=name,
        sink=resolved_sink,
        max_workers=max_workers,
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
