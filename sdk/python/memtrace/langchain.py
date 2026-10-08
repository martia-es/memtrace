"""Public entry point for LangChain / LangGraph integration.

Usage:
    from memtrace.langchain import MemTraceCallbackHandler, enable_langchain_instrumentation, prompt_middleware
"""
from memtrace.adapters.inbound.langchain import (
    MemTraceCallbackHandler,
    enable_langchain_instrumentation,
    prompt_middleware,
)

__all__ = ["MemTraceCallbackHandler", "enable_langchain_instrumentation", "prompt_middleware"]
