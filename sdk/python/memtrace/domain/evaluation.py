"""Value objects for offline evaluation (see ADR-027, roadmap Fase 1.75).

Deliberately plain: no MemTrace-specific type leaks into an `Evaluator`/`TaskFunction`
implementation, so evaluators written against this module stay portable outside MemTrace.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Mapping, Optional, Tuple, Union

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
    # Identity of the judge behind an `llm_judge` score (ADR-043); None for any other source.
    # `judge_prompt_hash` fingerprints the rubric template (system prompt + prompt skeleton),
    # not the per-item prompt, so it only changes when the judge itself changes.
    judge_model: Optional[str] = None
    judge_prompt_hash: Optional[str] = None


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
class ScoreSummary:
    """One evaluator's scores aggregated over a whole run (same semantics as MemTrace's API aggregates).

    `pass_rate` is the share of `True` for a boolean evaluator, `average` the mean for a numeric
    one; both are `None` for a categorical evaluator (no aggregation defined).
    """

    name: str
    data_type: ScoreDataType
    count: int
    pass_rate: Optional[float] = None
    average: Optional[float] = None


@dataclass(frozen=True)
class ExperimentResult:
    """The full outcome of one `run_experiment()` call: one dataset, one agent version.

    `dataset_version` identifies exactly which data the items came from: "major.minor" for a
    MemTrace dataset, a content fingerprint (`sha256:...`) for a local file, `None` for data the
    SDK cannot version (an in-memory list, a custom `DatasetSource` that doesn't expose `version`).
    """

    name: str
    items: List[EvalItemResult]
    dataset_version: Optional[str] = None

    @property
    def error_count(self) -> int:
        """Items whose `task` raised (they have no scores)."""
        return sum(1 for r in self.items if r.error is not None)

    def summary(self) -> List[ScoreSummary]:
        """Per-evaluator aggregate over every item — computed locally, no MemTrace needed."""
        grouped: Dict[Tuple[str, ScoreDataType], List[Score]] = {}
        for item_result in self.items:
            for score in item_result.scores:
                grouped.setdefault((score.name, score.data_type), []).append(score)
        summaries = []
        for (name, data_type), scores in grouped.items():
            pass_rate = average = None
            if data_type == "boolean":
                pass_rate = sum(1 for s in scores if s.value is True) / len(scores)
            elif data_type == "numeric":
                numbers = [float(s.value) for s in scores if isinstance(s.value, (int, float)) and not isinstance(s.value, bool)]
                average = sum(numbers) / len(numbers) if numbers else None
            summaries.append(ScoreSummary(name=name, data_type=data_type, count=len(scores), pass_rate=pass_rate, average=average))
        return summaries
