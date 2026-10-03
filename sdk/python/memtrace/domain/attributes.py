"""Builds span attributes from domain concepts. No OTel, no frameworks."""
from typing import Any, Dict, Mapping, Optional, Union

from memtrace.domain import semconv as sc
from memtrace.domain.model import LlmCall, StepType, step_type_value

Attributes = Dict[str, Any]  # None values are dropped by the outbound adapter

OPERATION_BY_STEP_TYPE = {
    StepType.LLM.value: "chat",
    StepType.TOOL.value: "execute_tool",
    StepType.AGENT.value: "invoke_agent",
    StepType.RETRIEVER.value: "retrieval",
    StepType.EMBEDDING.value: "embeddings",
}

_STEP_TYPE_BY_OPERATION = {op: step for step, op in OPERATION_BY_STEP_TYPE.items()}
# Traceloop's span kinds (opentelemetry-instrumentation-langchain)
_STEP_TYPE_BY_TRACELOOP_KIND = {"workflow": "chain", "task": "chain", "agent": "agent", "tool": "tool", "llm": "llm"}

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
    """Normalizes the provider name; if missing, infers it from the model name."""
    if provider:
        p = provider.strip().lower().split("-")[0]  # "openai-chat" -> "openai"
        return _PROVIDER_ALIASES.get(p, p)
    name = (model or "").lower()
    for prefix, prov in _MODEL_PREFIX_PROVIDERS:
        if name.startswith(prefix):
            return prov
    return None


def infer_step_type(attributes: Mapping[str, Any]) -> Optional[str]:
    """Step type of a span made by third-party instrumentation, from its standard attributes."""
    operation = attributes.get(sc.GEN_AI_OPERATION_NAME)
    if isinstance(operation, str) and operation in _STEP_TYPE_BY_OPERATION:
        return _STEP_TYPE_BY_OPERATION[operation]
    kind = attributes.get("traceloop.span.kind")
    return _STEP_TYPE_BY_TRACELOOP_KIND.get(kind) if isinstance(kind, str) else None


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
    """`input_messages`/`output_messages` are JSON already filtered by the capture policy."""
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


def retrieved_chunks(documents: Any) -> list:
    """Normalizes retrieved documents into `{"text", "id"?, "source"?, "score"?}` dicts (ADR-044).

    Accepts plain strings, mappings (`text`/`content`/`page_content`, `id`, `source`, `score`) and
    document-like objects with `page_content` and `metadata` (LangChain `Document`). Rank is the list position.
    """
    chunks = []
    for doc in documents or []:
        if isinstance(doc, str):
            chunks.append({"text": doc})
            continue
        if isinstance(doc, Mapping):
            text = doc.get("text", doc.get("content", doc.get("page_content")))
            meta: Mapping[str, Any] = {**(doc.get("metadata") or {}), **doc}
            doc_id = doc.get("id")
        else:
            text = getattr(doc, "page_content", None)
            meta = getattr(doc, "metadata", None) or {}
            doc_id = getattr(doc, "id", None) or meta.get("id")
        chunk = {"text": text if isinstance(text, str) else ("" if text is None else str(text))}
        for key, value in (("id", doc_id), ("source", meta.get("source")), ("score", meta.get("score"))):
            if value is not None:
                chunk[key] = value
        chunks.append(chunk)
    return chunks
