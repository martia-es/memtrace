import functools
import inspect
from contextlib import AbstractContextManager
from typing import Any, Dict, List, Optional, Sequence, Union

from memtrace.dependency_container import get_service
from memtrace.domain.attributes import step_input_attributes, step_output_attributes
from memtrace.domain.model import LlmCall, StepType


def trace_step_context(
    name: str,
    step_type: Union[StepType, str] = StepType.CHAIN,
    attributes: Optional[Dict[str, Any]] = None,
) -> AbstractContextManager:
    """Instrumenta un bloque; los spans creados dentro (incluidos los de LangChain o de
    librerías auto-instrumentadas) cuelgan de él. Rinde el `run_id`."""
    return get_service().step(name, step_type, attributes)


def _describe_call(func: Any, args: tuple, kwargs: dict) -> Any:
    try:
        bound = inspect.signature(func).bind_partial(*args, **kwargs)
        return {k: v for k, v in bound.arguments.items() if k not in ("self", "cls")}
    except Exception:
        return {"args": list(args), "kwargs": kwargs}


def trace_step(name: Optional[str] = None, step_type: Union[StepType, str] = StepType.CHAIN):
    """Decorador para funciones o métodos, síncronos o async, de agentes y tools.

    Con MEMTRACE_CAPTURE_CONTENT=true registra también argumentos y valor de retorno.
    """

    def decorator(func):
        span_name = name or func.__name__

        def record_input(service, run_id, args, kwargs) -> None:
            payload = _describe_call(func, args, kwargs) if service.captures_content else None
            service.annotate_run(run_id, step_input_attributes(step_type, span_name, service.capture(payload)))

        def record_output(service, run_id, result) -> None:
            service.annotate_run(run_id, step_output_attributes(step_type, service.capture(result)))

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                service = get_service()
                with service.step(span_name, step_type) as run_id:
                    record_input(service, run_id, args, kwargs)
                    result = await func(*args, **kwargs)
                    record_output(service, run_id, result)
                    return result

            return async_wrapper

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            service = get_service()
            with service.step(span_name, step_type) as run_id:
                record_input(service, run_id, args, kwargs)
                result = func(*args, **kwargs)
                record_output(service, run_id, result)
                return result

        return wrapper

    return decorator


def trace_llm_call(
    provider: str,
    model: str,
    operation: str = "chat",
    input_messages: Optional[List[Dict[str, Any]]] = None,
    output_messages: Optional[List[Dict[str, Any]]] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    *,
    response_model: Optional[str] = None,
    response_id: Optional[str] = None,
    finish_reasons: Sequence[str] = (),
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    top_p: Optional[float] = None,
    attributes: Optional[Dict[str, Any]] = None,
) -> None:
    """Registra en el span actual los atributos GenAI estandarizados. Nunca lanza."""
    call = LlmCall(
        provider=provider, model=model, operation=operation, response_model=response_model,
        response_id=response_id, finish_reasons=finish_reasons, input_tokens=input_tokens,
        output_tokens=output_tokens, temperature=temperature, max_tokens=max_tokens, top_p=top_p,
    )
    get_service().record_llm_call(call, input_messages, output_messages, attributes)
