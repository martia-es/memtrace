# memtrace (Python SDK)

Instrumenta agentes de IA y exporta trazas por OTLP (convenciones GenAI de OpenTelemetry). No conoce el almacén: solo habla con el OTel Collector.

```bash
pip install -e ".[langchain]"   # extras: http (OTLP/HTTP), langchain, dev
```

```python
from memtrace import init_tracer, trace_step, trace_llm_call, flush

init_tracer(service_name="mi-agente")   # o variables MEMTRACE_*

@trace_step(name="buscar", step_type="tool")
def buscar(q: str) -> str: ...

# LangChain / LangGraph
from memtrace.adapters.inbound.langchain import MemTraceCallbackHandler
chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})

flush()  # scripts cortos / serverless; shutdown() al salir
```

**Conversaciones**: envuelve cada turno con `with memtrace.session("id-de-la-conversacion"):` (o pasa `thread_id` / `session_id` / `conversation_id` en el `metadata` de LangChain) y el dashboard agrupará las trazas en una conversación. El id debe ser estable entre turnos, único por conversación y sin datos personales (aparece en las URLs). Sin él, cada turno queda como una traza suelta.

Los spans creados dentro de un `@trace_step` (o de `with memtrace.session("id")`) cuelgan de él, incluidos los del handler de LangChain y los de librerías auto-instrumentadas.

## Configuración

| Variable | Defecto | |
|---|---|---|
| `MEMTRACE_ENABLED` | `true` | `false` desactiva todo (no-op) |
| `MEMTRACE_SERVICE_NAME` | `default-agent` | `service.name` |
| `MEMTRACE_SERVICE_VERSION`, `MEMTRACE_ENVIRONMENT` | — | atributos del Resource |
| `MEMTRACE_OTLP_ENDPOINT` | `http://localhost:4317` (grpc) / `:4318` (http) | |
| `MEMTRACE_OTLP_PROTOCOL` | `grpc` | o `http/protobuf` (extra `http`) |
| `MEMTRACE_OTLP_HEADERS` | — | `k1=v1,k2=v2` |
| `MEMTRACE_CAPTURE_CONTENT` | `false` | guarda prompts/completions/argumentos (ADR-004) |
| `MEMTRACE_MAX_CONTENT_LENGTH` | `16384` | truncado del contenido capturado |
| `MEMTRACE_SPAN_TTL_SECONDS` | `3600` | cierra spans huérfanos |
| `MEMTRACE_EXPORT_TIMEOUT_MS`, `MEMTRACE_BATCH_MAX_QUEUE_SIZE`, `MEMTRACE_BATCH_SCHEDULE_DELAY_MS`, `MEMTRACE_BATCH_MAX_EXPORT_SIZE` | 5000 / 2048 / 5000 / 512 | `BatchSpanProcessor` |

TLS con certificado propio: `OTEL_EXPORTER_OTLP_CERTIFICATE` (estándar OTel) con un endpoint `https://`.

## Arquitectura

Hexagonal (ADR-008): `domain` (puro) → `application` (puerto `SpanPort` + `TracingService`) ← `adapters/inbound` (decoradores, LangChain) y `adapters/outbound` (OpenTelemetry, no-op). `dependency_container.py` es la composition root. La regla de dependencias la verifica `tests/test_architecture.py`.

## Tests

```bash
pip install -e ".[dev]" && pytest
```
