from typing import Any, Dict, List, Optional, Sequence

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service
from memtrace.domain.model import LlmCall


def trace_llm_call(
    provider: str,
    model: str,
    *,
    operation: str = "chat",
    input_messages: Optional[List[Dict[str, Any]]] = None,
    output_messages: Optional[List[Dict[str, Any]]] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    response_model: Optional[str] = None,
    response_id: Optional[str] = None,
    finish_reasons: Sequence[str] = (),
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    top_p: Optional[float] = None,
    frequency_penalty: Optional[float] = None,
    presence_penalty: Optional[float] = None,
    attributes: Optional[Dict[str, Any]] = None,
    service: Optional[TracingService] = None,
) -> None:
    """Records the standardized GenAI attributes on the current span. Never raises.

    Everything after `provider` and `model` is keyword-only.
    """
    call = LlmCall(
        provider=provider,
        model=model,
        operation=operation,
        response_model=response_model,
        response_id=response_id,
        finish_reasons=finish_reasons,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        frequency_penalty=frequency_penalty,
        presence_penalty=presence_penalty,
    )
    (service or get_service()).record_llm_call(call, input_messages, output_messages, attributes)
