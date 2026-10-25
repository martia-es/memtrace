"""`ToolPolicy`: the domain rules plus recording, logging and the `guard` decorator (see ADR-103)."""
import functools
import inspect
import logging
from typing import Any, Callable, Mapping, Optional

from memtrace.application.security.recorder import record
from memtrace.application.tracing_service import TracingService
from memtrace.domain.security import PolicyRules, ToolPolicyViolation, Verdict

logger = logging.getLogger("memtrace")


class ToolPolicy(PolicyRules):
    """See `PolicyRules`. Every decision that detects something becomes a `security.tool_policy` span."""

    def _service(self) -> Optional[TracingService]:
        """Where decisions are recorded; the public `memtrace.security.ToolPolicy` points it at the active tracer."""
        return None

    def check(self, tool: str, arguments: Optional[Mapping[str, Any]] = None) -> Verdict:
        verdict = self.evaluate(tool, arguments)
        if verdict.detected:
            record(self._service(), verdict)
            if verdict.action in ("warned", "blocked"):
                logger.warning("[MemTrace] tool policy %s: %s", verdict.severity, verdict.reason)
        return verdict

    def guard(self, func: Optional[Callable] = None, *, name: Optional[str] = None):
        """Decorator for a tool function: checks its arguments first and raises `ToolPolicyViolation` if blocked."""

        def decorator(fn: Callable):
            tool = name or fn.__name__
            signature = inspect.signature(fn)

            def verify(args: tuple, kwargs: dict) -> None:
                try:
                    arguments = dict(signature.bind_partial(*args, **kwargs).arguments)
                except TypeError:
                    arguments = dict(kwargs)
                verdict = self.check(tool, arguments)
                if verdict.blocked and verdict.error:
                    raise ToolPolicyViolation(verdict)

            if inspect.iscoroutinefunction(fn):

                @functools.wraps(fn)
                async def awrapper(*args, **kwargs):
                    verify(args, kwargs)
                    return await fn(*args, **kwargs)

                return awrapper

            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                verify(args, kwargs)
                return fn(*args, **kwargs)

            return wrapper

        return decorator(func) if func is not None else decorator
