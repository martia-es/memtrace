"""Public entry point for OpenAI Agents SDK integration.

Usage:
    from memtrace.openai_agents import enable_openai_agents_instrumentation
"""
from memtrace.adapters.inbound.openai_agents import MemTraceTracingProcessor, enable_openai_agents_instrumentation

__all__ = ["MemTraceTracingProcessor", "enable_openai_agents_instrumentation"]
