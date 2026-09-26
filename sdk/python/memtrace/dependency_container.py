"""Composition root: único sitio donde se elige qué adapters concretos se cablean."""
import logging
import threading
from typing import Any, Mapping, Optional

from memtrace.application.ports import SpanPort
from memtrace.application.tracing_service import TracingService
from memtrace.config import default_endpoint, settings
from memtrace.domain.model import CapturePolicy

logger = logging.getLogger("memtrace")

_lock = threading.Lock()
_service: Optional[TracingService] = None


def _build_port(
    service_name: Optional[str],
    endpoint: Optional[str],
    protocol: Optional[str],
    headers: Optional[Mapping[str, str]],
    span_exporter: Any,
) -> SpanPort:
    from memtrace.adapters.outbound.noop import NoopSpanPort

    if not settings.enabled:
        logger.info("[MemTrace] Desactivado (MEMTRACE_ENABLED=false).")
        return NoopSpanPort()
    try:
        from memtrace.adapters.outbound.otel.factory import OtelConfig, create_otel_adapter

        proto = protocol or settings.protocol
        config = OtelConfig(
            service_name=service_name or settings.service_name,
            endpoint=endpoint or settings.otlp_endpoint or default_endpoint(proto),
            protocol=proto,
            headers=dict(headers) if headers is not None else (settings.otlp_headers or None),
            service_version=settings.service_version,
            environment=settings.environment,
            export_timeout_ms=settings.export_timeout_ms,
            batch_max_queue_size=settings.batch_max_queue_size,
            batch_schedule_delay_ms=settings.batch_schedule_delay_ms,
            batch_max_export_size=settings.batch_max_export_size,
        )
        port = create_otel_adapter(config, span_exporter)
        if span_exporter is None:
            logger.info("[MemTrace] Exportando trazas a %s (%s)", config.endpoint, proto)
        return port
    except Exception as exc:  # incluye ImportError de OpenTelemetry
        logger.warning("[MemTrace] Backend OTel no disponible (%s). Modo no-op.", exc)
        return NoopSpanPort()


def init_tracer(
    service_name: Optional[str] = None,
    endpoint: Optional[str] = None,
    span_ttl_seconds: Optional[int] = None,
    protocol: Optional[str] = None,
    headers: Optional[Mapping[str, str]] = None,
    span_exporter: Any = None,
) -> TracingService:
    """Inicializa MemTrace. Idempotente y sin excepciones.

    `protocol`: "grpc" (defecto) o "http/protobuf". `span_exporter` sustituye al OTLP (tests).
    """
    global _service
    with _lock:
        if _service is None:
            _service = TracingService(
                port=_build_port(service_name, endpoint, protocol, headers, span_exporter),
                capture=CapturePolicy(settings.capture_content, settings.max_content_length),
                span_ttl_seconds=span_ttl_seconds if span_ttl_seconds is not None else settings.span_ttl_seconds,
            )
        return _service


def get_service() -> TracingService:
    return _service or init_tracer()


def flush(timeout_millis: int = 30000) -> bool:
    """Envía los spans pendientes sin cerrar el tracer."""
    return _service.flush(timeout_millis) if _service else True


def shutdown() -> None:
    """Vacía el buffer y cierra el tracer (llamar antes de salir del proceso)."""
    global _service
    with _lock:
        if _service is not None:
            _service.shutdown()
            _service = None
