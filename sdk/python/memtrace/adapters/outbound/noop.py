from contextlib import nullcontext
from typing import Any, ContextManager, Mapping, Optional

from memtrace.application.ports import SpanHandle


class NoopSpanHandle:
    def set_attributes(self, attributes: Mapping[str, Any]) -> None:
        pass

    def end(self, error: Optional[BaseException] = None) -> None:
        pass


class NoopSpanPort:
    """Null Object: se inyecta cuando MemTrace está desactivado o el backend no está disponible."""

    def start_span(self, name: str, attributes: Mapping[str, Any], parent: Optional[SpanHandle] = None) -> SpanHandle:
        return NoopSpanHandle()

    def activate(self, span: SpanHandle) -> ContextManager[None]:
        return nullcontext()

    def current(self) -> Optional[SpanHandle]:
        return None

    def flush(self, timeout_millis: int = 30000) -> bool:
        return True

    def shutdown(self) -> None:
        pass
