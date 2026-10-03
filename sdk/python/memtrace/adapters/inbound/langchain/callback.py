from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from memtrace.adapters.inbound.langchain.mapping import (
    generation_dicts,
    message_dicts,
    request_to_call,
    response_to_call,
    step_name,
)
from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service
from memtrace.domain import semconv as sc
from memtrace.domain.attributes import llm_attributes, retrieved_chunks
from memtrace.domain.model import StepType
from memtrace.domain.serialization import to_json

logger = logging.getLogger("memtrace")

_INSTALL_HINT = "pip install 'memtrace-ai[langchain]'"

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:
    class BaseCallbackHandler:  # type: ignore[no-redef]
        """Stand-in so importing this module never requires LangChain; instantiating does."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(f"MemTraceCallbackHandler requires LangChain: {_INSTALL_HINT}")


class MemTraceCallbackHandler(BaseCallbackHandler):
    """LangChain / LangGraph callback handler.

    Usage: `chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})`.
    Inside a `@trace_step`, its spans hang from it.
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
            # `thread_id` is the LangGraph conversation identifier
            sc.GEN_AI_CONVERSATION_ID: md.get("session_id") or md.get("conversation_id") or md.get("thread_id"),
            # LangGraph injects `langgraph_node`/`langgraph_step` into each run's metadata (ADR-011)
            sc.MEMTRACE_FRAMEWORK: "langgraph" if any(k.startswith("langgraph_") for k in md) else "langchain",
        }

    def _start(self, name, step_type, run_id, parent_run_id, tags, metadata, extra=None) -> None:
        attrs = {**self._context_attrs(tags, metadata), **(extra or {})}
        self._service.start_run(name, step_type, run_id=run_id, parent_run_id=parent_run_id, attributes=attrs)

    def _end(self, run_id, attrs=None, error=None) -> None:
        self._service.end_run(run_id, error=error, attributes=attrs)

    # ----- chains / agents -----

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs) -> Any:
        self._start(step_name(serialized, kwargs, "Chain"), StepType.CHAIN, run_id, parent_run_id, tags, metadata,
                    {sc.MEMTRACE_INPUT: self._service.capture(inputs)})

    def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, {sc.MEMTRACE_OUTPUT: self._service.capture(outputs)})

    def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- tools -----

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, tags=None, metadata=None, inputs=None, **kwargs) -> Any:
        name = step_name(serialized, kwargs, "Tool")
        self._start(name, StepType.TOOL, run_id, parent_run_id, tags, metadata, {
            sc.GEN_AI_TOOL_NAME: name,
            sc.GEN_AI_TOOL_CALL_ID: kwargs.get("tool_call_id"),
            sc.GEN_AI_TOOL_CALL_ARGUMENTS: self._service.capture(inputs if inputs is not None else input_str),
        })

    def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs) -> Any:
        result = getattr(output, "content", output)  # ToolMessage or plain value
        self._end(run_id, {sc.GEN_AI_TOOL_CALL_RESULT: self._service.capture(result)})

    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- retrievers -----

    def on_retriever_start(self, serialized, query, *, run_id, parent_run_id=None, tags=None, metadata=None, **kwargs) -> Any:
        self._start(step_name(serialized, kwargs, "Retriever"), StepType.RETRIEVER, run_id, parent_run_id, tags, metadata,
                    {sc.MEMTRACE_INPUT: self._service.capture(query)})

    def on_retriever_end(self, documents, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, {
            sc.MEMTRACE_RETRIEVER_DOCUMENTS: len(documents or []),
            sc.MEMTRACE_RETRIEVER_CHUNKS: self._service.capture(retrieved_chunks(documents)),
        })

    def on_retriever_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)

    # ----- LLMs -----

    def _llm_start(self, serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs, input_messages) -> None:
        call = request_to_call(metadata, invocation_params or kwargs.get("invocation_params") or {})
        base = step_name(serialized, {}, "llm")
        self._start(
            f"{base}: {call.model}" if call.model else base, StepType.LLM, run_id, parent_run_id, tags, metadata,
            llm_attributes(call, self._service.capture(input_messages)),
        )

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, tags=None, metadata=None, invocation_params=None, **kwargs) -> Any:
        self._llm_start(serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs,
                        message_dicts(messages) if self._service.captures_content else None)

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, tags=None, metadata=None, invocation_params=None, **kwargs) -> Any:
        self._llm_start(serialized, run_id, parent_run_id, tags, metadata, invocation_params, kwargs,
                        [{"role": "user", "content": p} for p in prompts])

    def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs) -> Any:
        try:
            output = generation_dicts(response) if self._service.captures_content else None
            attrs = llm_attributes(response_to_call(response), output_messages=self._service.capture(output))
        except Exception as exc:  # an unexpectedly shaped response must not lose the span
            logger.warning("[MemTrace] Error extracting data from the LLM response: %s", exc)
            attrs = None
        self._end(run_id, attrs)

    def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> Any:
        self._end(run_id, error=error)
