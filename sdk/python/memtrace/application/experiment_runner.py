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
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable, Mapping, Optional, Sequence, Union

from memtrace.application.context import get_current_run_id, session
from memtrace.application.eval_ports import (
    DatasetSource,
    Evaluator,
    InMemoryDatasetSource,
    ResultsSink,
    TaskFunction,
)
from memtrace.domain.evaluation import EvalItem, EvalItemResult, ExperimentResult, Score

logger = logging.getLogger("memtrace")


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


def _run_item(item: EvalItem, task: TaskFunction, evaluators: Sequence[Evaluator]) -> EvalItemResult:
    try:
        with session(str(uuid.uuid4())):
            output = task(item=item)
            run_id = get_current_run_id()
            trace_id = str(run_id) if run_id is not None else None
    except Exception as exc:
        logger.warning("[MemTrace] task raised for item, skipping evaluators: %s", exc)
        return EvalItemResult(item=item, error=str(exc))

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
            )
            scores.extend(result if isinstance(result, list) else [result])
        except Exception as exc:
            name = getattr(evaluator, "name", evaluator.__class__.__name__)
            logger.warning("[MemTrace] evaluator %r raised, recording as error score: %s", name, exc)
            scores.append(Score(name=name, value=str(exc), data_type="categorical", source="code", comment="evaluator raised"))

    return EvalItemResult(item=item, output=output, trace_id=trace_id, scores=scores)


def run_experiment(
    *,
    data: Union[DatasetSource, Iterable[Union[Mapping[str, Any], EvalItem]]],
    task: TaskFunction,
    evaluators: Sequence[Evaluator],
    name: str,
    sink: Optional[ResultsSink] = None,
    max_workers: int = 4,
) -> ExperimentResult:
    """Runs `task` against every item of `data` and scores each output with `evaluators`.

    A `task` exception fails only that item (`EvalItemResult.error`, no scores computed);
    an `Evaluator` exception fails only that evaluator's score for that item. `sink.save()`
    is called once at the end with the full result if `sink` is not None; the result is
    always returned regardless.
    """
    source = _resolve_source(data)
    items = list(source.fetch())

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(lambda item: _run_item(item, task, evaluators), items))

    result = ExperimentResult(name=name, items=results)
    if sink is not None:
        sink.save(result)
    return result
