"""Pure translation of LangChain structures into domain concepts. No `TracingService`, no OTel."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from memtrace.domain.model import LlmCall


def _get(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


def _as_int(val: Any) -> Optional[int]:
    return val if isinstance(val, int) and not isinstance(val, bool) else None


def _tokens(usage: Any) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """(input, output, total) from `usage_metadata` (LangChain), `token_usage` (OpenAI) or `usage` (Anthropic)."""
    if not usage:
        return None, None, None
    inp = _as_int(_get(usage, "input_tokens"))
    inp = inp if inp is not None else _as_int(_get(usage, "prompt_tokens"))
    out = _as_int(_get(usage, "output_tokens"))
    out = out if out is not None else _as_int(_get(usage, "completion_tokens"))
    return inp, out, _as_int(_get(usage, "total_tokens"))


def response_to_call(response: Any) -> LlmCall:
    """Response data of an `LLMResult` (duck-typed): messages first, `llm_output` as a fallback."""
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


def request_to_call(metadata: Optional[Dict[str, Any]], params: Dict[str, Any]) -> LlmCall:
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


def step_name(serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any], default: str) -> str:
    """`serialized` may be None (LangGraph, runnables); LangChain passes `name` as a kwarg."""
    ser = serialized or {}
    ident = ser.get("id")
    return kwargs.get("name") or ser.get("name") or (ident[-1] if ident else None) or default


def _tool_calls_of(msg: Any) -> Any:
    """`tool_calls` of the model message (or of `additional_kwargs` for some providers)."""
    calls = getattr(msg, "tool_calls", None)
    if not calls:
        calls = (getattr(msg, "additional_kwargs", None) or {}).get("tool_calls")
    return calls or None


def message_dicts(messages: List[List[Any]]) -> List[Dict[str, Any]]:
    out = []
    for batch in messages:
        for m in batch:
            d: Dict[str, Any] = {
                "role": getattr(m, "type", None) or getattr(m, "role", None) or "user",
                "content": getattr(m, "content", str(m)),
            }
            calls = _tool_calls_of(m)
            if calls:
                d["tool_calls"] = calls
            out.append(d)
    return out


def generation_dicts(response: Any) -> List[Dict[str, Any]]:
    out = []
    for gens in getattr(response, "generations", None) or []:
        for g in gens:
            msg = getattr(g, "message", None)
            d: Dict[str, Any] = {"role": getattr(msg, "type", "assistant"), "content": getattr(g, "text", "")}
            calls = _tool_calls_of(msg)
            if calls:
                d["tool_calls"] = calls
            out.append(d)
    return out
