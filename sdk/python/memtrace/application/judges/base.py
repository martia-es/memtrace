"""Base class for LLM-as-judge evaluators (see ADR-029).

Orchestrates the "ask an LLM to score this output" pattern behind the same `Evaluator`
protocol the rest of `memtrace.eval` uses: a concrete judge (`correctness.py`,
`faithfulness.py`) only supplies a rubric (`build_prompt`) and a `name`; calling the LLM and
turning its answer into a `Score` is shared here. `LLMClient` is a plain protocol
(`application/eval_ports.py`), so the LLM implementation used is never mandated by MemTrace —
see `adapters/outbound/llm` for a default one.
"""
import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any, Iterator, Mapping, Optional

from memtrace.application.eval_ports import LLMClient
from memtrace.domain.evaluation import Score

_RESPONSE_INSTRUCTIONS = (
    'Respond with a single JSON object and nothing else, of the shape '
    '{"score": true or false, "reasoning": "<one sentence>"}.'
)


class _Placeholders(Mapping[str, Any]):
    """Stand-in for `metadata` when fingerprinting a prompt template: any key resolves to `"{key}"`."""

    def __getitem__(self, key: str) -> str:
        return "{" + str(key) + "}"

    def __iter__(self) -> Iterator[str]:
        return iter(())

    def __len__(self) -> int:
        return 1  # truthy, so `if metadata` guards in build_prompt behave as with real metadata

    def __contains__(self, key: object) -> bool:
        return True


class LLMJudgeEvaluator(ABC):
    """Base for evaluators that ask an LLM to score `output`, instead of a code rule.

    Subclasses only implement `name` and `build_prompt`; this class owns calling `client`,
    parsing its answer, and producing a `Score(source="llm_judge")`. A malformed LLM response
    raises rather than guessing — `experiment_runner` already turns any evaluator exception
    into an error `Score` for just that item, so this class doesn't need its own fallback.
    """

    name: str

    def __init__(self, *, client: LLMClient, model: Optional[str] = None):
        self._client = client
        self._model = model

    @abstractmethod
    def build_prompt(
        self,
        *,
        input: Any,
        output: Any,
        expected_output: Optional[Any],
        metadata: Optional[Mapping[str, Any]],
    ) -> str:
        """Returns the rubric-specific user prompt asking the LLM to judge `output`."""
        ...

    def judge_model(self) -> Optional[str]:
        """Model that judges: the explicit `model=` if given, else the client's default (`client.model`), else None."""
        return self._model or getattr(self._client, "model", None)

    def prompt_hash(self) -> str:
        """Short, stable fingerprint of this judge's rubric (ADR-043).

        Hashes the system prompt plus `build_prompt` rendered with placeholders instead of real
        values, so it is identical across items and changes only when the rubric text does.
        A subclass whose `build_prompt` cannot render placeholders falls back to its class name.
        """
        try:
            skeleton = self.build_prompt(
                input="{input}", output="{output}", expected_output="{expected_output}", metadata=_Placeholders()
            )
        except Exception:
            skeleton = f"<{type(self).__module__}.{type(self).__qualname__}>"
        digest = hashlib.sha256(f"{self.system_prompt()}\x00{skeleton}".encode("utf-8")).hexdigest()
        return digest[:16]

    def system_prompt(self) -> str:
        """Override to change the judge's persona; keep the JSON response contract unless
        `__call__` is also overridden to parse something else."""
        return f"You are a strict, impartial evaluator. {_RESPONSE_INSTRUCTIONS}"

    def __call__(
        self,
        *,
        input: Any,
        output: Any,
        expected_output: Optional[Any] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Score:
        prompt = self.build_prompt(input=input, output=output, expected_output=expected_output, metadata=metadata)
        raw = self._client.complete(system=self.system_prompt(), prompt=prompt, model=self._model)
        parsed = _parse_response(raw)
        return Score(
            name=self.name,
            value=bool(parsed["score"]),
            data_type="boolean",
            source="llm_judge",
            comment=parsed.get("reasoning"),
            judge_model=self.judge_model(),
            judge_prompt_hash=self.prompt_hash(),
        )


def _parse_response(raw: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM judge returned non-JSON output: {raw!r}") from exc
    if "score" not in parsed:
        raise ValueError(f"LLM judge response missing 'score': {raw!r}")
    return parsed
