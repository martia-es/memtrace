"""`Correctness`: the free-form-answer counterpart to `exact_match` (see ADR-029)."""
from typing import Any, Mapping, Optional

from memtrace.application.judges.base import LLMJudgeEvaluator


class Correctness(LLMJudgeEvaluator):
    """Judges whether `output` is a correct answer by comparing it against `expected_output`
    *semantically* — unlike `exact_match`/`contains`, the wording doesn't have to match."""

    name = "correctness"

    def build_prompt(
        self,
        *,
        input: Any,
        output: Any,
        expected_output: Optional[Any],
        metadata: Optional[Mapping[str, Any]],
    ) -> str:
        return (
            f"Question:\n{input}\n\n"
            f"Expected answer:\n{expected_output}\n\n"
            f"Given answer:\n{output}\n\n"
            "Is the given answer correct, i.e. does it convey the same meaning as the expected "
            "answer even if worded differently? Judge correctness only, ignore style."
        )
