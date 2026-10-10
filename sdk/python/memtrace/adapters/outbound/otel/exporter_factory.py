"""Builds the OTLP exporter per protocol. Adding one = registering a function."""
from typing import Callable, Dict, Mapping, Optional

from memtrace.config import PROTOCOL_GRPC, PROTOCOL_HTTP


def _grpc(endpoint: str, headers: Optional[Mapping[str, str]], timeout_s: float):
    try:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    except ImportError as exc:
        raise ImportError('OTLP/gRPC needs the grpc extra: pip install "memtrace-ai[grpc]"') from exc

    # With https and no credentials the standard certificates apply (OTEL_EXPORTER_OTLP_CERTIFICATE)
    return OTLPSpanExporter(
        endpoint=endpoint,
        insecure=not endpoint.startswith("https://"),
        headers=dict(headers) if headers else None,
        timeout=timeout_s,
    )


def _http(endpoint: str, headers: Optional[Mapping[str, str]], timeout_s: float):
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    if not endpoint.rstrip("/").endswith("/v1/traces"):
        endpoint = endpoint.rstrip("/") + "/v1/traces"
    return OTLPSpanExporter(
        endpoint=endpoint, headers=dict(headers) if headers else None, timeout=timeout_s
    )


_BUILDERS: Dict[str, Callable] = {PROTOCOL_GRPC: _grpc, PROTOCOL_HTTP: _http}


def build_otlp_exporter(protocol: str, endpoint: str, headers: Optional[Mapping[str, str]], timeout_ms: int):
    try:
        builder = _BUILDERS[protocol]
    except KeyError:
        raise ValueError(f"Unsupported OTLP protocol: {protocol!r}") from None
    return builder(endpoint, headers, max(timeout_ms / 1000, 0.001))
