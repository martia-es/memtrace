"""Public entry point for Pydantic AI integration.

Usage:
    from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation
"""
from memtrace.adapters.inbound.pydantic_ai import enable_pydantic_ai_instrumentation

__all__ = ["enable_pydantic_ai_instrumentation"]
