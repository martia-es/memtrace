import os
from typing import Dict, Optional, Tuple

_TRUE = ("1", "true", "yes", "on")

PROTOCOL_GRPC = "grpc"
PROTOCOL_HTTP = "http/protobuf"
_DEFAULT_ENDPOINTS = {
    PROTOCOL_GRPC: "http://localhost:4317",
    PROTOCOL_HTTP: "http://localhost:4318",
}


def default_endpoint(protocol: str) -> str:
    return _DEFAULT_ENDPOINTS[protocol]


def env_bool(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in _TRUE


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def parse_headers(raw: Optional[str]) -> Dict[str, str]:
    """Parses 'k1=v1,k2=v2' (same format as OTEL_EXPORTER_OTLP_HEADERS)."""
    headers: Dict[str, str] = {}
    for pair in (raw or "").split(","):
        key, sep, value = pair.partition("=")
        if sep and key.strip():
            headers[key.strip()] = value.strip()
    return headers


class Settings:
    """Configuration read from the environment on every access (eases tests and live changes)."""

    @property
    def enabled(self) -> bool:
        return env_bool("MEMTRACE_ENABLED", True)

    @property
    def protocol(self) -> str:
        val = os.getenv("MEMTRACE_OTLP_PROTOCOL", PROTOCOL_GRPC).strip().lower()
        return PROTOCOL_HTTP if val in ("http", "http/protobuf") else PROTOCOL_GRPC

    @property
    def otlp_endpoint(self) -> Optional[str]:
        """Explicit endpoint; if None, `default_endpoint(protocol)` is used."""
        return os.getenv("MEMTRACE_OTLP_ENDPOINT") or None

    @property
    def otlp_headers(self) -> Dict[str, str]:
        return parse_headers(os.getenv("MEMTRACE_OTLP_HEADERS"))

    @property
    def service_name(self) -> str:
        return os.getenv("MEMTRACE_SERVICE_NAME", "default-agent")

    @property
    def service_version(self) -> Optional[str]:
        return os.getenv("MEMTRACE_SERVICE_VERSION")

    @property
    def environment(self) -> Optional[str]:
        return os.getenv("MEMTRACE_ENVIRONMENT")

    @property
    def capture_content(self) -> bool:
        return env_bool("MEMTRACE_CAPTURE_CONTENT", False)

    @property
    def max_content_length(self) -> int:
        return env_int("MEMTRACE_MAX_CONTENT_LENGTH", 16384)

    @property
    def redact_keys(self) -> Tuple[str, ...]:
        """Extra key fragments to mask in captured content (comma-separated), on top of the defaults."""
        raw = os.getenv("MEMTRACE_REDACT_KEYS") or ""
        return tuple(k.strip().lower() for k in raw.split(",") if k.strip())

    @property
    def max_active_runs(self) -> int:
        return env_int("MEMTRACE_MAX_ACTIVE_RUNS", 10_000)

    @property
    def span_ttl_seconds(self) -> int:
        return env_int("MEMTRACE_SPAN_TTL_SECONDS", 3600)

    @property
    def export_timeout_ms(self) -> int:
        return env_int("MEMTRACE_EXPORT_TIMEOUT_MS", 5000)

    @property
    def batch_max_queue_size(self) -> int:
        return env_int("MEMTRACE_BATCH_MAX_QUEUE_SIZE", 2048)

    @property
    def batch_schedule_delay_ms(self) -> int:
        return env_int("MEMTRACE_BATCH_SCHEDULE_DELAY_MS", 5000)

    @property
    def batch_max_export_size(self) -> int:
        return env_int("MEMTRACE_BATCH_MAX_EXPORT_SIZE", 512)

    @property
    def api_url(self) -> Optional[str]:
        """Base URL of the MemTrace query API, used by the optional `memtrace.eval` HTTP adapters."""
        return os.getenv("MEMTRACE_API_URL") or None

    @property
    def api_key(self) -> Optional[str]:
        return os.getenv("MEMTRACE_API_KEY") or None


settings = Settings()
