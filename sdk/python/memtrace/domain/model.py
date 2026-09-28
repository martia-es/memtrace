from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional, Sequence, Tuple, Union

from memtrace.domain.serialization import DEFAULT_SENSITIVE_KEYS, to_json


class StepType(str, Enum):
    """Kind of agent step. Arbitrary `str` values are accepted too."""

    CHAIN = "chain"
    AGENT = "agent"
    TOOL = "tool"
    LLM = "llm"
    RETRIEVER = "retriever"
    EMBEDDING = "embedding"


def step_type_value(step_type: Union[StepType, str]) -> str:
    return step_type.value if isinstance(step_type, StepType) else str(step_type)


@dataclass(frozen=True)
class CapturePolicy:
    """Content capture policy (ADR-004): opt-in and truncated. Sensitive keys are masked at capture time;
    the full redaction of everything that is exported happens in the exporter (ADR-021)."""

    enabled: bool = False
    max_length: int = 16384
    redact_keys: Tuple[str, ...] = DEFAULT_SENSITIVE_KEYS

    def apply(self, payload: Any) -> Optional[str]:
        """Bounded, redacted JSON of the content, or None if capture is disabled."""
        if not self.enabled or payload is None:
            return None
        return to_json(payload, self.max_length, self.redact_keys)


@dataclass
class LlmCall:
    """Data of an LLM call (request and/or response); everything is optional."""

    provider: Optional[str] = None
    model: Optional[str] = None
    operation: str = "chat"
    response_model: Optional[str] = None
    response_id: Optional[str] = None
    finish_reasons: Sequence[str] = ()
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None

    @property
    def resolved_total_tokens(self) -> Optional[int]:
        if self.total_tokens is not None:
            return self.total_tokens
        if self.input_tokens is not None and self.output_tokens is not None:
            return self.input_tokens + self.output_tokens
        return None
