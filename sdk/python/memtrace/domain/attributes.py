"""Construcción de atributos de span a partir de conceptos del dominio. Sin OTel ni frameworks."""
from typing import Any, Dict, Optional, Union

from memtrace.domain import semconv as sc
from memtrace.domain.model import LlmCall, StepType, step_type_value

Attributes = Dict[str, Any]  # los valores None se descartan en el adapter de salida

OPERATION_BY_STEP_TYPE = {
    StepType.LLM.value: "chat",
    StepType.TOOL.value: "execute_tool",
    StepType.AGENT.value: "invoke_agent",
    StepType.RETRIEVER.value: "retrieval",
    StepType.EMBEDDING.value: "embeddings",
}

_PROVIDER_ALIASES = {
    "google_genai": "gcp.gemini",
    "google_vertexai": "gcp.vertex_ai",
    "vertexai": "gcp.vertex_ai",
    "bedrock": "aws.bedrock",
    "amazon_bedrock": "aws.bedrock",
    "azure": "azure.ai.openai",
    "azure_openai": "azure.ai.openai",
}
_MODEL_PREFIX_PROVIDERS = (
    ("gpt", "openai"), ("o1", "openai"), ("o3", "openai"), ("o4", "openai"),
    ("claude", "anthropic"), ("gemini", "gcp.gemini"),
    ("mistral", "mistral_ai"), ("command", "cohere"), ("llama", "meta"),
)


def normalize_provider(provider: Optional[str], model: Optional[str] = None) -> Optional[str]:
    """Normaliza el proveedor; si falta, lo infiere del nombre del modelo."""
    if provider:
        p = provider.strip().lower().split("-")[0]  # "openai-chat" -> "openai"
        return _PROVIDER_ALIASES.get(p, p)
    name = (model or "").lower()
    for prefix, prov in _MODEL_PREFIX_PROVIDERS:
        if name.startswith(prefix):
            return prov
    return None


def step_start_attributes(step_type: Union[StepType, str], session_id: Optional[str] = None) -> Attributes:
    kind = step_type_value(step_type)
    return {
        sc.MEMTRACE_STEP_TYPE: kind,
        sc.GEN_AI_OPERATION_NAME: OPERATION_BY_STEP_TYPE.get(kind),
        sc.GEN_AI_CONVERSATION_ID: session_id,
    }


def step_input_attributes(step_type: Union[StepType, str], name: str, captured: Optional[str]) -> Attributes:
    if step_type_value(step_type) == StepType.TOOL.value:
        return {sc.GEN_AI_TOOL_NAME: name, sc.GEN_AI_TOOL_CALL_ARGUMENTS: captured}
    return {sc.MEMTRACE_INPUT: captured}


def step_output_attributes(step_type: Union[StepType, str], captured: Optional[str]) -> Attributes:
    key = sc.GEN_AI_TOOL_CALL_RESULT if step_type_value(step_type) == StepType.TOOL.value else sc.MEMTRACE_OUTPUT
    return {key: captured}


def llm_attributes(
    call: LlmCall,
    input_messages: Optional[str] = None,
    output_messages: Optional[str] = None,
) -> Attributes:
    """`input_messages`/`output_messages` son JSON ya filtrado por la política de captura."""
    return {
        sc.GEN_AI_OPERATION_NAME: call.operation,
        sc.GEN_AI_PROVIDER_NAME: normalize_provider(call.provider, call.model),
        sc.GEN_AI_REQUEST_MODEL: call.model,
        sc.GEN_AI_RESPONSE_MODEL: call.response_model,
        sc.GEN_AI_RESPONSE_ID: call.response_id,
        sc.GEN_AI_RESPONSE_FINISH_REASONS: list(call.finish_reasons) or None,
        sc.GEN_AI_USAGE_INPUT_TOKENS: call.input_tokens,
        sc.GEN_AI_USAGE_OUTPUT_TOKENS: call.output_tokens,
        sc.GEN_AI_USAGE_TOTAL_TOKENS: call.resolved_total_tokens,
        sc.GEN_AI_REQUEST_TEMPERATURE: call.temperature,
        sc.GEN_AI_REQUEST_MAX_TOKENS: call.max_tokens,
        sc.GEN_AI_REQUEST_TOP_P: call.top_p,
        sc.GEN_AI_REQUEST_FREQUENCY_PENALTY: call.frequency_penalty,
        sc.GEN_AI_REQUEST_PRESENCE_PENALTY: call.presence_penalty,
        sc.GEN_AI_INPUT_MESSAGES: input_messages,
        sc.GEN_AI_OUTPUT_MESSAGES: output_messages,
    }
