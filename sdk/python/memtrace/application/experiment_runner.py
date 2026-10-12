"""Core offline-evaluation orchestration: iterate a dataset, run `task`, run `evaluators`.

Runs entirely in the caller's process (see ADR-027) — there is no MemTrace service behind
this. Framework/adapter-agnostic on purpose: takes a `DatasetSource` (or a bare iterable)
and an optional `ResultsSink`, never imports a concrete adapter itself. The public,
MemTrace-convenienced facade (`memtrace.eval.run_experiment`) wires the default HTTP
adapters on top of this.
"""
import inspect
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from typing import Any, Callable, ContextManager, Iterable, Mapping, Optional, Sequence, Union

from memtrace.application.eval_ports import (
    DatasetSource,
    Evaluator,
    IncrementalResultsSink,
    InMemoryDatasetSource,
    ResultsSink,
    TaskFunction,
)
from memtrace.application.retrieval_capture import retrieval_scope
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, RepeatedExperimentResult, RunRepeat, Score

logger = logging.getLogger("memtrace")

# Opens the scope in which one item's `task` runs and yields the trace id of that scope (or None). Lets the
# caller put each item in its own trace without this module knowing about any tracing backend.
ItemScope = Callable[[EvalItem], ContextManager[Optional[str]]]


class ResultsUploadError(RuntimeError):
    """The sink failed to persist the results. The experiment itself finished: `result` has everything."""

    def __init__(self, message: str, result: ExperimentResult):
        super().__init__(message)
        self.result = result


def _resolve_source(data: Union[DatasetSource, Iterable[Union[Mapping[str, Any], EvalItem]]]) -> DatasetSource:
    if isinstance(data, DatasetSource):
        return data
    return InMemoryDatasetSource(data)


def _call_evaluator(evaluator: Evaluator, **available: Any) -> Any:
    """Passes only the keyword arguments `evaluator` actually declares (or all of them if it takes `**kwargs`)."""
    params = inspect.signature(evaluator).parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return evaluator(**available)
    return evaluator(**{k: v for k, v in available.items() if k in params})


def _run_item(item: EvalItem, task: TaskFunction, evaluators: Sequence[Evaluator], item_scope: Optional[ItemScope] = None) -> EvalItemResult:
    trace_id: Optional[str] = None
    try:
        with retrieval_scope() as retrieved:
            with item_scope(item) if item_scope is not None else nullcontext() as scope_trace_id:
                trace_id = scope_trace_id
                output = task(item=item)
    except Exception as exc:
        logger.warning("[MemTrace] task raised for item, skipping evaluators: %s", exc)
        return EvalItemResult(item=item, error=str(exc), trace_id=trace_id)

    scores = []
    for evaluator in evaluators:
        try:
            result = _call_evaluator(
                evaluator,
                input=item.input,
                output=output,
                expected_output=item.expected_output,
                metadata=item.metadata,
                trace_id=trace_id,
                retrieved_chunks=retrieved,
            )
            scores.extend(result if isinstance(result, list) else [result])
        except Exception as exc:
            name = getattr(evaluator, "name", evaluator.__class__.__name__)
            logger.warning("[MemTrace] evaluator %r raised, recording as error score: %s", name, exc)
            scores.append(Score(name=name, value=str(exc), data_type="categorical", source="code", comment="evaluator raised"))

    return EvalItemResult(item=item, output=output, trace_id=trace_id, scores=scores)


MAX_REPEATS = 10


def _accepts_repeat(start: Callable[..., Any]) -> bool:
    params = inspect.signature(start).parameters
    return "repeat" in params or any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())


def run_experiment(
    *,
    data: Union[DatasetSource, Iterable[Union[Mapping[str, Any], EvalItem]]],
    task: TaskFunction,
    evaluators: Sequence[Evaluator],
    name: str,
    sink: Optional[ResultsSink] = None,
    max_workers: int = 4,
    item_scope: Optional[ItemScope] = None,
    repeats: int = 1,
) -> Union[ExperimentResult, RepeatedExperimentResult]:
    """Runs `task` against every item of `data` and scores each output with `evaluators`.

    A `task` exception fails only that item (`EvalItemResult.error`, no scores computed);
    an `Evaluator` exception fails only that evaluator's score for that item.

    With an `IncrementalResultsSink`, results are pushed item by item as they finish (in completion
    order, each with its dataset position); with a plain `ResultsSink`, `save()` is called once at the end. If persisting fails
    after the items ran, `ResultsUploadError` is raised carrying the full `result`.

    `item_scope` (optional) wraps each `task` call and yields the trace id the item's spans belong to; it is
    recorded on the result so the dashboard can read latency, tokens and cost from that trace (ADR-044).

    `repeats` (1-10, default 1): run the whole experiment that many times in one call, under identical
    conditions (same code, dataset version, evaluators), so MemTrace can tell the noise of the evaluation
    apart from real changes (ADR-097). With 1 you get an `ExperimentResult` as always; with more, a
    `RepeatedExperimentResult` holding one `ExperimentResult` per execution. Each execution is uploaded as
    its own run and they are grouped in the dashboard. It multiplies time and tokens by `repeats`. The
    dataset is read once, so every execution sees exactly the same items; executions run one after another.
    """
    if not isinstance(repeats, int) or isinstance(repeats, bool) or not 1 <= repeats <= MAX_REPEATS:
        raise ValueError(f"repeats must be an integer between 1 and {MAX_REPEATS}; got {repeats!r}")
    source = _resolve_source(data)
    items = list(source.fetch())
    dataset_version: Optional[str] = getattr(source, "version", None)

    incremental = sink if isinstance(sink, IncrementalResultsSink) else None
    if repeats > 1 and incremental is not None and not _accepts_repeat(incremental.start):
        raise ValueError(
            "this sink's start() does not accept `repeat=`, which repeats > 1 needs to group the executions "
            "(add `repeat: Optional[RunRepeat] = None` to start(), ADR-097)"
        )

    group_id = str(uuid.uuid4())
    executions = [
        _execute_once(items, dataset_version, task, evaluators, name, sink, incremental, max_workers, item_scope,
                      RunRepeat(group_id=group_id, index=i, total=repeats) if repeats > 1 else None)
        for i in range(1, repeats + 1)
    ]
    if repeats == 1:
        return executions[0]
    return RepeatedExperimentResult(name=name, executions=executions, dataset_version=dataset_version)


def _execute_once(
    items: list,
    dataset_version: Optional[str],
    task: TaskFunction,
    evaluators: Sequence[Evaluator],
    name: str,
    sink: Optional[ResultsSink],
    incremental: Optional[IncrementalResultsSink],
    max_workers: int,
    item_scope: Optional[ItemScope],
    repeat: Optional[RunRepeat],
) -> ExperimentResult:
    if incremental is not None:
        if repeat is not None:
            incremental.start(name=name, dataset_version=dataset_version, repeat=repeat)  # type: ignore[call-arg]
        else:
            incremental.start(name=name, dataset_version=dataset_version)

    results: list = [None] * len(items)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_run_item, item, task, evaluators, item_scope): index for index, item in enumerate(items)}
        for future in as_completed(futures):
            index = futures[future]
            results[index] = future.result()
            if incremental is not None:
                try:
                    incremental.add(index, results[index])
                except Exception as exc:
                    logger.warning("[MemTrace] sink.add raised, continuing the experiment: %s", exc)

    result = ExperimentResult(name=name, items=results, dataset_version=dataset_version, repeat=repeat)
    try:
        if incremental is not None:
            incremental.finish(result)
        elif sink is not None:
            sink.save(result)
    except Exception as exc:
        raise ResultsUploadError(f"experiment {name!r} finished but its results could not be saved: {exc}", result) from exc
    return result
