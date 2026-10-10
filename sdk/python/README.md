# memtrace-ai (Python SDK)

Instruments AI agents and exports traces over OTLP (OpenTelemetry GenAI conventions). It does not know the storage: it only talks to the OTel Collector.

> The package is published on PyPI as `memtrace-ai`; the Python import is `memtrace`.

```bash
pip install memtrace-ai
# extras: http (OTLP/HTTP), langchain, eval, pydantic-ai, pii, dev
```

```python
from memtrace import init_tracer, trace_step, trace_llm_call, shutdown

init_tracer(service_name="my-agent")   # or MEMTRACE_* environment variables

@trace_step(name="search", step_type="tool")
def search(q: str) -> str: ...

# LangChain / LangGraph - Option 1: manual callback handler
from memtrace.langchain import MemTraceCallbackHandler
chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})

# LangChain / LangGraph - Option 2: automatic (pip install 'memtrace-ai[langchain]')
# from memtrace.langchain import enable_langchain_instrumentation
# enable_langchain_instrumentation()   # once, after init_tracer(); do not combine with option 1

# Pydantic AI - automatic (pip install 'memtrace-ai[pydantic-ai]')
# from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation
# enable_pydantic_ai_instrumentation()

shutdown()  # optional: the OTel SDK also flushes at exit; use flush() in short scripts / serverless
```

**Error policy**: the tracing calls never raise into your code. The only exceptions are the `enable_*_instrumentation()` functions, which raise `ImportError` if their extra is not installed.

**Conversations**: wrap each turn with `with memtrace.session("conversation-id"):` (or pass `thread_id` / `session_id` / `conversation_id` in LangChain's `metadata`) and the dashboard groups the traces into one conversation. The id must be stable across turns, unique per conversation and free of personal data (it shows up in URLs). Without it, every turn is a standalone trace. `session()` also applies to spans emitted by auto-instrumented libraries.

Spans created inside a `@trace_step` (or inside `with memtrace.session("id")`) hang from it, including those of the LangChain handler and of auto-instrumented libraries.

`trace_step`, `trace_step_context` and `trace_llm_call` accept `service=` (the value returned by `init_tracer`) to use an explicit tracer instead of the global one.

## Configuration

| Variable | Default | |
|---|---|---|
| `MEMTRACE_ENABLED` | `true` | `false` disables everything (no-op) |
| `MEMTRACE_SERVICE_NAME` | `default-agent` | `service.name` |
| `MEMTRACE_SERVICE_VERSION`, `MEMTRACE_ENVIRONMENT` | - | Resource attributes |
| `MEMTRACE_OTLP_ENDPOINT` | `http://localhost:4317` (grpc) / `:4318` (http) | |
| `MEMTRACE_OTLP_PROTOCOL` | `grpc` | or `http/protobuf` (extra `http`) |
| `MEMTRACE_OTLP_HEADERS` | - | `k1=v1,k2=v2` |
| `MEMTRACE_CAPTURE_CONTENT` | `false` | store prompts/completions/arguments (ADR-004); also gates the auto-instrumentations |
| `MEMTRACE_MAX_CONTENT_LENGTH` | `16384` | truncation of captured content |
| `MEMTRACE_REDACT_KEYS` | - | extra key names to mask, on top of the built-in list (ADR-021) |
| `MEMTRACE_SPAN_TTL_SECONDS` | `3600` | closes orphaned spans |
| `MEMTRACE_MAX_ACTIVE_RUNS` | `10000` | cap on in-flight spans |
| `MEMTRACE_EXPORT_TIMEOUT_MS`, `MEMTRACE_BATCH_MAX_QUEUE_SIZE`, `MEMTRACE_BATCH_SCHEDULE_DELAY_MS`, `MEMTRACE_BATCH_MAX_EXPORT_SIZE` | 5000 / 2048 / 5000 / 512 | `BatchSpanProcessor` |

**Redaction**: secrets are masked in every exported span, by key name (`api_key`, `password`, …) and by shape (`sk-…`, JWTs, `Bearer …`, URL credentials). Personal data (emails, names, IDs) is anonymized only if you opt in with the `pii` extra: `init_tracer(redact=presidio_redactor(language="es"))` (`from memtrace.pii import presidio_redactor`; also `python -m spacy download <model>`), or with your own `init_tracer(redact=fn)`.

Self-signed TLS: `OTEL_EXPORTER_OTLP_CERTIFICATE` (standard OTel) with an `https://` endpoint.

## Architecture

Hexagonal (ADR-008): `domain` (pure) → `application` (`SpanPort` port + `TracingService`) ← `adapters/inbound` (decorators, LangChain, Pydantic AI) and `adapters/outbound` (OpenTelemetry, no-op). `dependency_container.py` is the composition root. The dependency rule is checked by `tests/test_architecture.py`. Auto-instrumentors receive MemTrace's tracer provider explicitly, never a global one, and every span passes through a redacting exporter before it leaves the process (ADR-021).

## Development

```bash
pip install -e ".[dev,http]"
ruff check memtrace tests && mypy memtrace && pytest
```
