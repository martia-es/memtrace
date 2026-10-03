"""Composition root: the only place that chooses which concrete adapters get wired."""
import logging
import threading
from collections.abc import Mapping
from typing import Any, Callable, Dict, Optional

from memtrace.application.ports import SpanPort
from memtrace.application.tracing_service import TracingService
from memtrace.config import default_endpoint, settings
from memtrace.domain.model import CapturePolicy
from memtrace.domain.redaction import Redactor
from memtrace.domain.serialization import DEFAULT_SENSITIVE_KEYS

logger = logging.getLogger("memtrace")

_lock = threading.Lock()
_service: Optional[TracingService] = None
_init_args: Dict[str, Any] = {}


def _build_port(
    service_name: Optional[str],
    endpoint: Optional[str],
    protocol: Optional[str],
    headers: Optional[Mapping[str, str]],
    span_exporter: Any,
    redactor: Redactor,
) -> SpanPort:
    from memtrace.adapters.outbound.noop import NoopSpanPort

    if not settings.enabled:
        logger.info("[MemTrace] Disabled (MEMTRACE_ENABLED=false).")
        return NoopSpanPort()
    try:
        from memtrace.adapters.outbound.otel.factory import (
            OtelConfig,
            create_otel_adapter,
        )
        from memtrace.adapters.outbound.otel.switchable_provider import SHARED_PROVIDER

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
        port = create_otel_adapter(config, span_exporter, redactor, SHARED_PROVIDER)
        if span_exporter is None:
            logger.info("[MemTrace] Exporting traces to %s (%s)", config.endpoint, proto)
        return port
    except Exception as exc:  # includes the ImportError of OpenTelemetry
        logger.warning("[MemTrace] OTel backend unavailable (%s). Running as no-op.", exc)
        return NoopSpanPort()


def _warn_ignored_arguments(explicit: Dict[str, Any]) -> None:
    changed = sorted(k for k, v in explicit.items() if _init_args.get(k) != v)
    if changed:
        logger.warning(
            "[MemTrace] init_tracer() ignored %s: the tracer is already initialized "
            "(possibly implicitly by an instrumented call made before init_tracer). "
            "Call shutdown() first to reconfigure it.",
            ", ".join(changed),
        )


def init_tracer(
    service_name: Optional[str] = None,
    endpoint: Optional[str] = None,
    span_ttl_seconds: Optional[int] = None,
    protocol: Optional[str] = None,
    headers: Optional[Mapping[str, str]] = None,
    span_exporter: Any = None,
    redact: Optional[Callable[[Any], Any]] = None,
) -> TracingService:
    """Initializes MemTrace. Idempotent and never raises.

    `protocol`: "grpc" (default) or "http/protobuf". `span_exporter` replaces OTLP (tests).
    `redact`: optional hook for personal data that has no recognizable shape. It runs on every
    exported span, after the built-in masking of secrets (by key and by value, see ADR-021), and
    receives JSON-compatible data or text and returns what to keep.

    Calling it again while already initialized returns the existing service; arguments that
    differ from the first call are ignored with a warning.
    """
    global _service, _init_args
    explicit = {
        k: v
        for k, v in dict(
            service_name=service_name,
            endpoint=endpoint,
            span_ttl_seconds=span_ttl_seconds,
            protocol=protocol,
            headers=dict(headers) if headers is not None else None,
            span_exporter=span_exporter,
            redact=redact,
        ).items()
        if v is not None
    }
    redact_keys = DEFAULT_SENSITIVE_KEYS + settings.redact_keys
    with _lock:
        if _service is None:
            _init_args = explicit
            _service = TracingService(
                port=_build_port(
                    service_name, endpoint, protocol, headers, span_exporter, Redactor(redact_keys, redact)
                ),
                capture=CapturePolicy(
                    enabled=settings.capture_content,
                    max_length=settings.max_content_length,
                    redact_keys=redact_keys,
                ),
                span_ttl_seconds=span_ttl_seconds if span_ttl_seconds is not None else settings.span_ttl_seconds,
                max_active_runs=settings.max_active_runs,
            )
        else:
            _warn_ignored_arguments(explicit)
        return _service


def active_service() -> Optional[TracingService]:
    """The tracer only if `init_tracer` already ran: never initializes anything as a side effect."""
    return _service


def get_service() -> TracingService:
    """The active service, initializing it from the environment if `init_tracer` was not called."""
    return _service or init_tracer()


def flush(timeout_millis: int = 30000) -> bool:
    """Sends pending spans without closing the tracer."""
    return _service.flush(timeout_millis) if _service else True


def shutdown() -> None:
    """Flushes the buffer and closes the tracer (the OTel SDK also does this at interpreter exit)."""
    global _service, _init_args
    with _lock:
        if _service is not None:
            _service.shutdown()
            _service = None
            _init_args = {}
