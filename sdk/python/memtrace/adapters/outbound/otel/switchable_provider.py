"""A tracer provider whose target can change over the life of the process (ADR-021).

Third-party instrumentors (LangChain's) bind to a provider once and cannot be re-bound. They get
this stable object instead; `init_tracer` / `shutdown` only move its target. While there is no
target, spans are dropped silently instead of reaching a provider that was already shut down.
"""
from typing import Any, Optional

from opentelemetry.trace import NoOpTracer, Tracer, TracerProvider

_NOOP = NoOpTracer()


class _SwitchableTracer(Tracer):
    def __init__(self, owner: "SwitchableTracerProvider", scope: tuple) -> None:
        self._owner = owner
        self._scope = scope
        self._cached: Optional[tuple] = None  # (provider, tracer)

    def _tracer(self) -> Tracer:
        provider = self._owner.target
        if provider is None:
            return _NOOP
        cached = self._cached
        if cached is None or cached[0] is not provider:
            name, version, schema_url, attributes = self._scope
            cached = (provider, provider.get_tracer(name, version, schema_url, attributes))
            self._cached = cached
        return cached[1]

    def start_span(self, *args: Any, **kwargs: Any) -> Any:
        return self._tracer().start_span(*args, **kwargs)

    def start_as_current_span(self, *args: Any, **kwargs: Any) -> Any:
        return self._tracer().start_as_current_span(*args, **kwargs)


class SwitchableTracerProvider(TracerProvider):
    def __init__(self) -> None:
        self.target: Optional[Any] = None

    def get_tracer(
        self,
        instrumenting_module_name: str,
        instrumenting_library_version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Any] = None,
    ) -> Tracer:
        return _SwitchableTracer(
            self, (instrumenting_module_name, instrumenting_library_version, schema_url, attributes)
        )


# One per process: what auto-instrumentors are bound to
SHARED_PROVIDER = SwitchableTracerProvider()
