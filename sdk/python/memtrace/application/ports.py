"""Puerto de salida: lo que la aplicación necesita de un backend de trazado."""
from typing import ContextManager, Mapping, Any, Optional, Protocol


class SpanHandle(Protocol):
    def set_attributes(self, attributes: Mapping[str, Any]) -> None: ...

    def end(self, error: Optional[BaseException] = None) -> None:
        """Cierra el span; con `error` queda marcado como fallido."""


class SpanPort(Protocol):
    def start_span(
        self, name: str, attributes: Mapping[str, Any], parent: Optional[SpanHandle] = None
    ) -> SpanHandle:
        """Con `parent=None` el span cuelga del span *actual* si existe; si no, abre una traza."""

    def activate(self, span: SpanHandle) -> ContextManager[None]:
        """Hace de `span` el span actual durante el bloque (sin cerrarlo al salir)."""

    def current(self) -> Optional[SpanHandle]:
        """Span actual en escritura, si lo hay."""

    def flush(self, timeout_millis: int = 30000) -> bool: ...

    def shutdown(self) -> None: ...
