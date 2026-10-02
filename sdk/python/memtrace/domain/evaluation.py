"""Value objects for offline evaluation (see ADR-027, roadmap Fase 1.75).

Deliberately plain: no MemTrace-specific type leaks into an `Evaluator`/`TaskFunction`
implementation, so evaluators written against this module stay portable outside MemTrace.
"""
from dataclasses import dataclass, field
from typing import Any, List, Literal, Mapping, Optional, Union

ScoreDataType = Literal["numeric", "boolean", "categorical"]
ScoreSource = Literal["human", "code", "llm_judge"]


@dataclass(frozen=True)
class Score:
    """One evaluator's verdict on one item.

    `data_type` should match the Python type of `value` (numeric -> float,
    boolean -> bool, categorical -> str) so a `ResultsSink` can store it faithfully.
    """

    name: str
    value: Union[float, bool, str]
    data_type: ScoreDataType
    source: ScoreSource = "code"
    comment: Optional[str] = None


@dataclass(frozen=True)
class EvalItem:
    """One row of a dataset: what to feed the agent and, optionally, what to expect back."""

    input: Any
    expected_output: Optional[Any] = None
    metadata: Optional[Mapping[str, Any]] = None


@dataclass(frozen=True)
class EvalItemResult:
    """The outcome of running one `EvalItem` through a `task` and its evaluators.

    `error` is set (and `scores` left empty) when `task` itself raised; a failing
    evaluator instead contributes an error `Score` for just that evaluator (see
    `application.experiment_runner`), so one bad evaluator never blanks the row.
    """

    item: EvalItem
    output: Any = None
    trace_id: Optional[str] = None
    scores: List[Score] = field(default_factory=list)
    error: Optional[str] = None


@dataclass(frozen=True)
class ExperimentResult:
    """The full outcome of one `run_experiment()` call: one dataset, one agent version."""

    name: str
    items: List[EvalItemResult]
