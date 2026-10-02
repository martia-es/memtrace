"""`Faithfulness`: grounding/hallucination check against a source context (see ADR-029)."""
from typing import Any, Mapping, Optional

from memtrace.application.judges.base import LLMJudgeEvaluator


class Faithfulness(LLMJudgeEvaluator):
    """Judges whether `output` is grounded in a source context, with no unsupported claims
    (hallucination). Needs `metadata={"context": "..."}` on the `EvalItem` — raises a clear
    error if it's missing, rather than silently judging against nothing."""

    name = "faithfulness"

    def build_prompt(
        self,
        *,
        input: Any,
        output: Any,
        expected_output: Optional[Any],
        metadata: Optional[Mapping[str, Any]],
    ) -> str:
        context = metadata.get("context") if metadata else None
        if not context:
            raise ValueError(
                "Faithfulness needs metadata={'context': ...} on the EvalItem — the source "
                "text the output is supposed to be grounded in."
            )
        return (
            f"Context:\n{context}\n\n"
            f"Question:\n{input}\n\n"
            f"Answer:\n{output}\n\n"
            "Is every claim in the answer supported by the context, with no invented facts? "
            "A partially unsupported answer is not faithful."
        )
