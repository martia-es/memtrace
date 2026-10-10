"""Tracing processor for the OpenAI Agents SDK: turns its traces and spans into MemTrace spans (ADR-095).

The Agents SDK has its own tracing (`agents.tracing`): every run is a *trace* made of typed *spans* (agent, generation,
response, function, handoff, guardrail, MCP). A `TracingProcessor` receives them as they start and end; this one opens and
closes a MemTrace run for each, so they are exported with the same attributes as any other framework.
"""
from __future__ import annotations

import logging
import threading
import uuid
from typing import Any, Dict, Optional

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service
from memtrace.domain import semconv as sc
from memtrace.domain.attributes import llm_attributes
from memtrace.domain.model import LlmCall, StepType

logger = logging.getLogger("memtrace")

_INSTALL_HINT = "pip install 'memtrace-ai[openai-agents]'"
FRAMEWORK = "openai-agents"

try:
    from agents.tracing import TracingProcessor
except ImportError:
    class TracingProcessor:  # type: ignore[no-redef]
        """Stand-in so importing this module never requires the Agents SDK; instantiating does."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(f"MemTraceTracingProcessor requires the OpenAI Agents SDK: {_INSTALL_HINT}")


def _plain(value: Any) -> Any:
    """JSON-friendly form of a pydantic model (Responses API items) or any other value."""
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return dump(mode="json", exclude_none=True)
        except Exception:  # an odd item must not lose the span
            return str(value)
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def _usage(source: Any) -> tuple:
    """(input_tokens, output_tokens) from a dict or an object with those names."""
    if source is None:
        return None, None
    get = source.get if isinstance(source, dict) else lambda key: getattr(source, key, None)
    return get("input_tokens"), get("output_tokens")


class MemTraceTracingProcessor(TracingProcessor):
    """Register it with `agents.add_trace_processor(MemTraceTracingProcessor())`, or call
    `enable_openai_agents_instrumentation()` which does it for you."""

    def __init__(self, service: Optional[TracingService] = None) -> None:
        super().__init__()
        self._service = service or get_service()
        self._lock = threading.Lock()
        self._runs: Dict[str, uuid.UUID] = {}      # Agents SDK span id / trace id -> MemTrace run id
        self._sessions: Dict[str, Optional[str]] = {}  # trace id -> group_id (the conversation)

    # ----- traces: the workflow is the root run -----

    def on_trace_start(self, trace: Any) -> None:
        try:
            run_id = uuid.uuid4()
            with self._lock:
                self._runs[trace.trace_id] = run_id
                self._sessions[trace.trace_id] = getattr(trace, "group_id", None)
            attrs = self._common(trace.trace_id)
            metadata = getattr(trace, "metadata", None)
            if metadata:
                attrs[sc.MEMTRACE_METADATA] = self._service.capture(metadata)
            self._service.start_run(trace.name or "Agent workflow", StepType.CHAIN, run_id=run_id, attributes=attrs)
        except Exception as exc:
            logger.warning("[MemTrace] OpenAI Agents trace start failed: %s", exc)

    def on_trace_end(self, trace: Any) -> None:
        try:
            with self._lock:
                run_id = self._runs.pop(trace.trace_id, None)
                self._sessions.pop(trace.trace_id, None)
            if run_id is not None:
                self._service.end_run(run_id)
        except Exception as exc:
            logger.warning("[MemTrace] OpenAI Agents trace end failed: %s", exc)

    # ----- spans -----

    def on_span_start(self, span: Any) -> None:
        try:
            name, step_type, attrs = self._describe(span.span_data)
            run_id = uuid.uuid4()
            with self._lock:
                self._runs[span.span_id] = run_id
                parent = self._runs.get(span.parent_id) if span.parent_id else self._runs.get(span.trace_id)
            self._service.start_run(name, step_type, run_id=run_id, parent_run_id=parent,
                                    attributes={**self._common(span.trace_id), **attrs})
        except Exception as exc:
            logger.warning("[MemTrace] OpenAI Agents span start failed: %s", exc)

    def on_span_end(self, span: Any) -> None:
        try:
            with self._lock:
                run_id = self._runs.pop(span.span_id, None)
            if run_id is None:
                return
            error = getattr(span, "error", None)
            self._service.end_run(
                run_id, error=RuntimeError(error.get("message", "error")) if error else None,
                attributes=self._on_end(span.span_data),
            )
        except Exception as exc:
            logger.warning("[MemTrace] OpenAI Agents span end failed: %s", exc)

    def shutdown(self) -> None:
        with self._lock:
            self._runs.clear()
            self._sessions.clear()

    def force_flush(self) -> None:
        return None

    # ----- mapping -----

    def _common(self, trace_id: str) -> Dict[str, Any]:
        with self._lock:
            conversation = self._sessions.get(trace_id)
        return {sc.MEMTRACE_FRAMEWORK: FRAMEWORK, sc.GEN_AI_CONVERSATION_ID: conversation}

    def _describe(self, data: Any) -> tuple:
        """(name, step type, attributes known when the span opens)."""
        kind = getattr(data, "type", "custom")
        capture = self._service.capture
        if kind == "agent":
            md = {"handoffs": data.handoffs, "tools": data.tools, "output_type": data.output_type}
            return data.name, StepType.CHAIN, {sc.MEMTRACE_METADATA: capture({k: v for k, v in md.items() if v})}
        if kind == "task":  # one top-level `Runner` run
            return data.name or "task", StepType.CHAIN, {}
        if kind == "turn":  # one loop of the agent; its `usage` is the sum of its model calls, so it is not copied
            return f"turn {data.turn}", StepType.CHAIN, {}
        if kind == "function":
            mcp = getattr(data, "mcp_data", None) or {}
            return data.name, StepType.TOOL, {
                sc.GEN_AI_TOOL_NAME: data.name,
                sc.MEMTRACE_MCP_SERVER: mcp.get("server") or None,
            }
        if kind in ("generation", "response"):
            model = getattr(data, "model", None) or getattr(getattr(data, "response", None), "model", None)
            return (f"openai: {model}" if model else "openai"), StepType.LLM, {}
        if kind == "handoff":
            return f"handoff: {data.from_agent} -> {data.to_agent}", StepType.CHAIN, {
                sc.MEMTRACE_METADATA: capture({"from_agent": data.from_agent, "to_agent": data.to_agent})}
        if kind == "guardrail":
            return f"guardrail: {data.name}", StepType.CHAIN, {}
        if kind == "mcp_tools":
            return f"mcp list tools: {data.server}", StepType.TOOL, {sc.MEMTRACE_MCP_SERVER: data.server or None}
        return getattr(data, "name", None) or kind, StepType.CHAIN, {}

    def _on_end(self, data: Any) -> Dict[str, Any]:
        """Attributes known only when the span closes (content, usage, results)."""
        kind = getattr(data, "type", "custom")
        capture, captures = self._service.capture, self._service.captures_content
        if kind == "function":
            # `mcp_data` may be filled in after the span opened, so the server is read again here
            return {sc.GEN_AI_TOOL_CALL_ARGUMENTS: capture(data.input), sc.GEN_AI_TOOL_CALL_RESULT: capture(data.output),
                    sc.MEMTRACE_MCP_SERVER: (getattr(data, "mcp_data", None) or {}).get("server") or None}
        if kind == "generation":
            config = data.model_config or {}
            tokens_in, tokens_out = _usage(data.usage)
            call = LlmCall(provider="openai", model=data.model, input_tokens=tokens_in, output_tokens=tokens_out,
                           temperature=config.get("temperature"), max_tokens=config.get("max_tokens"), top_p=config.get("top_p"))
            return llm_attributes(call, capture(_plain(data.input)) if captures else None,
                                  capture(_plain(data.output)) if captures else None)
        if kind == "response":
            response = data.response
            tokens_in, tokens_out = _usage(data.usage if data.usage else getattr(response, "usage", None))
            call = LlmCall(
                provider="openai", model=getattr(response, "model", None), response_model=getattr(response, "model", None),
                response_id=getattr(response, "id", None), input_tokens=tokens_in, output_tokens=tokens_out,
                temperature=getattr(response, "temperature", None), top_p=getattr(response, "top_p", None))
            return llm_attributes(call, capture(_plain(data.input)) if captures else None,
                                  capture(_plain(getattr(response, "output", None))) if captures else None)
        if kind == "guardrail":
            return {sc.MEMTRACE_METADATA: capture({"triggered": data.triggered})}
        if kind == "mcp_tools":
            return {sc.GEN_AI_TOOL_CALL_RESULT: capture(data.result)}
        return {}
