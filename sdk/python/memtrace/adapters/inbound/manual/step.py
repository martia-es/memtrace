import functools
import inspect
from contextlib import AbstractContextManager
from typing import Any, Dict, Optional, Union

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service
from memtrace.domain.attributes import step_input_attributes, step_output_attributes
from memtrace.domain.model import StepType


def trace_step_context(
    name: str,
    step_type: Union[StepType, str] = StepType.CHAIN,
    attributes: Optional[Dict[str, Any]] = None,
    *,
    service: Optional[TracingService] = None,
) -> AbstractContextManager:
    """Instruments a block; spans created inside it (including those of LangChain or of
    auto-instrumented libraries) hang from it. Yields the `run_id`.

    `service` selects an explicit tracer (from `init_tracer`); by default the global one is used.
    """
    return (service or get_service()).step(name, step_type, attributes)


def _describe_call(func: Any, args: tuple, kwargs: dict) -> Any:
    try:
        bound = inspect.signature(func).bind_partial(*args, **kwargs)
        return {k: v for k, v in bound.arguments.items() if k not in ("self", "cls")}
    except Exception:
        return {"args": list(args), "kwargs": kwargs}


def trace_step(
    name: Optional[str] = None,
    step_type: Union[StepType, str] = StepType.CHAIN,
    *,
    service: Optional[TracingService] = None,
):
    """Decorator for sync or async functions and methods of agents and tools.

    With MEMTRACE_CAPTURE_CONTENT=true it also records the arguments and the return value.
    `service` selects an explicit tracer; by default the global one is used.
    """

    def decorator(func):
        span_name = name or func.__name__

        def record_input(svc, run_id, args, kwargs) -> None:
            payload = _describe_call(func, args, kwargs) if svc.captures_content else None
            svc.annotate_run(run_id, step_input_attributes(step_type, span_name, svc.capture(payload)))

        def record_output(svc, run_id, result) -> None:
            svc.annotate_run(run_id, step_output_attributes(step_type, svc.capture(result)))

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                svc = service or get_service()
                with svc.step(span_name, step_type) as run_id:
                    record_input(svc, run_id, args, kwargs)
                    result = await func(*args, **kwargs)
                    record_output(svc, run_id, result)
                    return result

            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            svc = service or get_service()
            with svc.step(span_name, step_type) as run_id:
                record_input(svc, run_id, args, kwargs)
                result = func(*args, **kwargs)
                record_output(svc, run_id, result)
                return result

        return wrapper

    return decorator
