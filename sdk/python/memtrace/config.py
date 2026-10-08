import os
import re
import subprocess
from typing import Dict, Optional, Tuple

_TRUE = ("1", "true", "yes", "on")

PROTOCOL_GRPC = "grpc"
PROTOCOL_HTTP = "http/protobuf"
_DEFAULT_ENDPOINTS = {
    PROTOCOL_GRPC: "http://localhost:4317",
    PROTOCOL_HTTP: "http://localhost:4318",
}


# Variables que fijan el commit, por orden de prioridad (ADR-065): la explícita, la que inyecta el CI en el build y
# las de las plataformas que ya la exponen.
REVISION_ENV_VARS = (
    "MEMTRACE_GIT_SHA",
    "GIT_SHA",
    "GITHUB_SHA",
    "CI_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "RENDER_GIT_COMMIT",
    "HEROKU_SLUG_COMMIT",
)
_SHA = re.compile(r"^[0-9a-f]{7,64}$")


def _git(*args: str) -> Optional[str]:
    try:
        out = subprocess.run(["git", *args], capture_output=True, text=True, timeout=2, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def resolve_revision() -> Tuple[Optional[str], Optional[bool]]:
    """Commit del código que se ejecuta y si tiene cambios sin commitear (ADR-065).

    Primero las variables de entorno (el `dirty` es desconocido: `None`); si no hay ninguna, `git` en el directorio
    actual (desarrollo local, donde sí se sabe si el árbol está sucio). Nunca falla: sin commit devuelve `(None, None)`.
    """
    for name in REVISION_ENV_VARS:
        value = (os.getenv(name) or "").strip().lower()
        if _SHA.match(value):
            return value, None
    sha = (_git("rev-parse", "HEAD") or "").lower()
    if not _SHA.match(sha):
        return None, None
    status = _git("status", "--porcelain")
    return sha, (None if status is None else status != "")


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
    def revision(self) -> Tuple[Optional[str], Optional[bool]]:
        """(commit, dirty) del código en ejecución; ver `resolve_revision`."""
        return resolve_revision()

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

    @property
    def prompt_refresh_seconds(self) -> float:
        """How often a prompt that follows a tag asks the registry whether the tag moved (an unchanged tag costs a 304)."""
        return float(env_int("MEMTRACE_PROMPT_REFRESH_SECONDS", 30))

    @property
    def prompt_usage_seconds(self) -> float:
        """How often the SDK tells MemTrace which prompt versions this agent is using."""
        return float(env_int("MEMTRACE_PROMPT_USAGE_SECONDS", 300))

    @property
    def prompt_timeout_seconds(self) -> float:
        return float(env_int("MEMTRACE_PROMPT_TIMEOUT_SECONDS", 3))

    @property
    def prompt_cache_dir(self) -> Optional[str]:
        """Directory where the last known prompt versions are kept, so an agent can start while MemTrace is down."""
        return os.getenv("MEMTRACE_PROMPT_CACHE_DIR") or None


settings = Settings()
