"""Outbound port: what the application needs from a tracing backend."""
from typing import Any, ContextManager, Mapping, Optional, Protocol


class SpanHandle(Protocol):
    @property
    def trace_id(self) -> Optional[str]:
        """Backend trace id of this span as 32 lowercase hex chars (the id the dashboard and the query API use), or None."""

    def set_attributes(self, attributes: Mapping[str, Any]) -> None: ...

    def end(self, error: Optional[BaseException] = None) -> None:
        """Ends the span; with `error` it is marked as failed."""


class SpanPort(Protocol):
    def start_span(
        self, name: str, attributes: Mapping[str, Any], parent: Optional[SpanHandle] = None
    ) -> SpanHandle:
        """With `parent=None` the span hangs from the *current* span if any; otherwise it opens a trace."""

    def activate(self, span: SpanHandle) -> ContextManager[None]:
        """Makes `span` the current span during the block (without ending it on exit)."""

    def current(self) -> Optional[SpanHandle]:
        """The current recording span, if any."""

    @property
    def tracer_provider(self) -> Any:
        """Backend-native tracer provider for third-party auto-instrumentors, or None.

        Opaque to the application: only inbound adapters hand it to the framework they
        instrument (see ADR-021), so MemTrace never has to set a process-global provider.
        """

    def flush(self, timeout_millis: int = 30000) -> bool: ...

    def shutdown(self) -> None: ...
