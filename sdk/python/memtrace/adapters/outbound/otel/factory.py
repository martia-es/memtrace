from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor

from memtrace.adapters.outbound.otel.exporter_factory import build_otlp_exporter
from memtrace.adapters.outbound.otel.sanitizing_exporter import SanitizingSpanExporter
from memtrace.adapters.outbound.otel.session_processor import SessionSpanProcessor
from memtrace.adapters.outbound.otel.span_adapter import OtelSpanAdapter
from memtrace.adapters.outbound.otel.switchable_provider import SwitchableTracerProvider
from memtrace.domain.redaction import Redactor


@dataclass
class OtelConfig:
    service_name: str
    endpoint: str
    protocol: str
    headers: Optional[Dict[str, str]] = None
    service_version: Optional[str] = None
    environment: Optional[str] = None
    export_timeout_ms: int = 5000
    batch_max_queue_size: int = 2048
    batch_schedule_delay_ms: int = 5000
    batch_max_export_size: int = 512
    resource_attributes: Dict[str, str] = field(default_factory=dict)


def create_otel_adapter(
    config: OtelConfig,
    span_exporter: Any = None,
    redactor: Optional[Redactor] = None,
    shared_provider: Optional[SwitchableTracerProvider] = None,
) -> OtelSpanAdapter:
    """`span_exporter` replaces OTLP and exports synchronously (tests).

    Every span goes through a `SanitizingSpanExporter` (default `Redactor` if none is given).
    `shared_provider` is the process-wide switchable provider handed to auto-instrumentors: its
    target is pointed at this adapter's provider.
    """
    redactor = redactor or Redactor()
    attrs: Dict[str, str] = {"service.name": config.service_name, **config.resource_attributes}
    if config.service_version:
        attrs["service.version"] = config.service_version
    if config.environment:
        attrs["deployment.environment.name"] = config.environment

    provider = TracerProvider(resource=Resource.create(attrs))
    # tags spans made by auto-instrumented libraries with the active `session()` (runs before export)
    provider.add_span_processor(SessionSpanProcessor())
    if span_exporter is not None:
        provider.add_span_processor(SimpleSpanProcessor(SanitizingSpanExporter(span_exporter, redactor)))
    else:
        otlp = build_otlp_exporter(config.protocol, config.endpoint, config.headers, config.export_timeout_ms)
        provider.add_span_processor(
            BatchSpanProcessor(
                SanitizingSpanExporter(otlp, redactor),
                max_queue_size=config.batch_max_queue_size,
                schedule_delay_millis=config.batch_schedule_delay_ms,
                max_export_batch_size=config.batch_max_export_size,
                export_timeout_millis=config.export_timeout_ms,
            )
        )
    if shared_provider is not None:
        shared_provider.target = provider
    return OtelSpanAdapter(provider.get_tracer("memtrace"), provider, shared_provider)
