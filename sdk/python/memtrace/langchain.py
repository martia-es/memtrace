"""Public entry point for LangChain / LangGraph integration.

Usage:
    from memtrace.langchain import MemTraceCallbackHandler, enable_langchain_instrumentation
"""
from memtrace.adapters.inbound.langchain import (
    MemTraceCallbackHandler,
    enable_langchain_instrumentation,
)

__all__ = ["MemTraceCallbackHandler", "enable_langchain_instrumentation"]
