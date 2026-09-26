from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service
from memtrace.domain import semconv as sc
from memtrace.domain.attributes import llm_attributes
from memtrace.domain.model import LlmCall, StepType
from memtrace.domain.serialization import to_json

logger = logging.getLogger("memtrace")

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:
    # Sin LangChain instalado se evita el ImportError; el handler no llegará a usarse
    class BaseCallbackHandler:  # type: ignore[no-redef]
        pass


# ----- traducción de estructuras de LangChain a conceptos del dominio -----

def _get(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


def _as_int(val: Any) -> Optional[int]:
    return val if isinstance(val, int) and not isinstance(val, bool) else None


def _tokens(usage: Any) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """(input, output, total) desde `usage_metadata` (LangChain), `token_usage` (OpenAI) o `usage` (Anthropic)."""
    if not usage:
        return None, None, None
    inp = _as_int(_get(usage, "input_tokens"))
    inp = inp if inp is not None else _as_int(_get(usage, "prompt_tokens"))
    out = _as_int(_get(usage, "output_tokens"))
    out = out if out is not None else _as_int(_get(usage, "completion_tokens"))
    return inp, out, _as_int(_get(usage, "total_tokens"))


def _response_to_call(response: Any) -> LlmCall:
    """Datos de respuesta de un `LLMResult` (duck-typed): mensajes primero, `llm_output` de respaldo."""
    inp = out = total = None
    model = resp_id = None
    finish: List[str] = []

    for gens in getattr(response, "generations", None) or []:
        for gen in gens or []:
            msg = _get(gen, "message")
            meta = _get(msg, "response_metadata") or {}
            info = _get(gen, "generation_info") or {}
            if inp is None and out is None:
                inp, out, total = _tokens(_get(msg, "usage_metadata"))
            model = model or _get(meta, "model_name") or _get(meta, "model")
            resp_id = resp_id or _get(msg, "id") or _get(meta, "id")
            reason = _get(info, "finish_reason") or _get(meta, "finish_reason") or _get(meta, "stop_reason")
            if reason:
                finish.append(str(reason))

    llm_output = getattr(response, "llm_output", None) or {}
    if inp is None and out is None:
        inp, out, total = _tokens(_get(llm_output, "token_usage") or _get(llm_output, "usage"))
    model = model or _get(llm_output, "model_name") or _get(llm_output, "model")
    return LlmCall(
        response_model=model, response_id=resp_id, finish_reasons=finish,
        input_tokens=inp, output_tokens=out, total_tokens=total,
    )


def _request_to_call(metadata: Optional[Dict[str, Any]], params: Dict[str, Any]) -> LlmCall:
    md = metadata or {}
    return LlmCall(
        provider=md.get("ls_provider") or params.get("_type"),
        model=md.get("ls_model_name") or params.get("model_name") or params.get("model") or params.get("model_id"),
        temperature=md.get("ls_temperature", params.get("temperature")),
        max_tokens=md.get("ls_max_tokens", params.get("max_tokens") or params.get("max_tokens_to_sample")),
        top_p=params.get("top_p"),
        frequency_penalty=params.get("frequency_penalty"),
        presence_penalty=params.get("presence_penalty"),
    )


def _name(serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any], default: str) -> str:
    """`serialized` puede ser None (LangGraph, runnables); LangChain pasa `name` como kwarg."""
    ser = serialized or {}
    ident = ser.get("id")
    return kwargs.get("name") or ser.get("name") or (ident[-1] if ident else None) or default


def _message_dicts(messages: List[List[Any]]) -> List[Dict[str, Any]]:
    return [
        {"role": getattr(m, "type", None) or getattr(m, "role", None) or "user", "content": getattr(m, "content", str(m))}
        for batch in messages
        for m in batch
    ]


def _generation_dicts(response: Any) -> List[Dict[str, Any]]:
    return [
        {"role": getattr(getattr(g, "message", None), "type", "assistant"), "content": getattr(g, "text", "")}
        for gens in getattr(response, "generations", None) or []
        for g in gens
    ]


class MemTraceCallbackHandler(BaseCallbackHandler):
    """CallbackHandler de LangChain / LangGraph.

    Uso: `chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})`.
    Dentro de un `@trace_step`, sus spans cuelgan de él.
    """

    def __init__(self, service: Optional[TracingService] = None) -> None:
        super().__init__()
        self._service = service or get_service()

    # ----- helpers -----

    def _context_attrs(self, tags: Optional[List[str]], metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        md = metadata or {}
        return {
            sc.MEMTRACE_TAGS: [str(t) for t in tags] if tags else None,
            sc.MEMTRACE_METADATA: to_json(md, self._service.max_content_length) if md else None,
            # `thread_id` es el identificador de conversación de LangGraph
            sc.GEN_AI_CONVERSATION_ID: md.get("session_id") or md.get("conversation_id") or md.get("thread_id"),
        }

    def _start(self, name, step_type, run_id, parent_run_id, tags, metadata, extra=None) -> None:
        attrs = {**self._context_attrs(tags, metadata), **(extra or {})}
        self._service.start_run(name, step_type, run_id=run_id, parent_run_id=parent_run_id, attributes=attrs)

    def _end(self, run_id, attrs=None, error=None) -> None:
        self._service.end_run(run_id, error=error, attributes=attrs)

    # ----- chains / agents -----

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs) -> Any:
        self._start(_name(serialized, kwargs, "Chain"), StepType.CHAIN, run_id, parent_run_id, tags, metadata,
                    {sc.MEMTRACE_INPUT: self._service.capture(inputs)})

    def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, {sc.MEMTRACE_OUTPUT: self._service.capture(outputs)})

    def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- tools -----

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, tags=None, metadata=None, inputs=None, **kwargs) -> Any:
        name = _name(serialized, kwargs, "Tool")
        self._start(name, StepType.TOOL, run_id, parent_run_id, tags, metadata, {
            sc.GEN_AI_TOOL_NAME: name,
            sc.GEN_AI_TOOL_CALL_ID: kwargs.get("tool_call_id"),
            sc.GEN_AI_TOOL_CALL_ARGUMENTS: self._service.capture(inputs if inputs is not None else input_str),
        })

    def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs) -> Any:
        result = getattr(output, "content", output)  # ToolMessage o valor plano
        self._end(run_id, {sc.GEN_AI_TOOL_CALL_RESULT: self._service.capture(result)})

    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- retrievers -----

    def on_retriever_start(self, serialized, query, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs) -> Any:
        self._start(_name(serialized, kwargs, "Retriever"), StepType.RETRIEVER, run_id, parent_run_id, tags, metadata,
                    {sc.MEMTRACE_INPUT: self._service.capture(query)})

    def on_retriever_end(self, documents, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, {sc.MEMTRACE_RETRIEVER_DOCUMENTS: len(documents or [])})

    def on_retriever_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- LLMs -----

    def _llm_start(self, serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs, input_messages) -> None:
        call = _request_to_call(metadata, invocation_params or kwargs.get("invocation_params") or {})
        base = _name(serialized, {}, "llm")
        self._start(
            f"{base}: {call.model}" if call.model else base, StepType.LLM, run_id, parent_run_id, tags, metadata,
            llm_attributes(call, self._service.capture(input_messages)),
        )

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, tags=None, metadata=None, invocation_params=None, **kwargs) -> Any:
        self._llm_start(serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs,
                        _message_dicts(messages) if self._service.captures_content else None)

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, tags=None, metadata=None, invocation_params=None, **kwargs) -> Any:
        self._llm_start(serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs,
                        [{"role": "user", "content": p} for p in prompts])

    def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs) -> Any:
        try:
            output = _generation_dicts(response) if self._service.captures_content else None
            attrs = llm_attributes(_response_to_call(response), output_messages=self._service.capture(output))
        except Exception as exc:  # una respuesta con forma inesperada no debe perder el span
            logger.warning("[MemTrace] Error extrayendo datos de la respuesta LLM: %s", exc)
            attrs = None
        self._end(run_id, attrs)

    def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)
