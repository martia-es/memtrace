# Bring your own backend

The tracing part of the library is plain OpenTelemetry: it exports standard OTLP spans to whatever endpoint you give it. You can use it with the MemTrace platform, with your own OpenTelemetry Collector, or with any tool that receives OTLP, and switch between them by changing configuration only. Your agent code stays the same.

## Choose where traces go

| Destination | `protocol` | `endpoint` | Extra needed |
|---|---|---|---|
| MemTrace platform | `http/protobuf` | `https://<host>/api/v1/ingest` + API key header ([Authentication](./authentication)) | none |
| Your OpenTelemetry Collector (HTTP) | `http/protobuf` (default) | `http://<collector>:4318` | none |
| Your OpenTelemetry Collector (gRPC) | `grpc` | `http://<collector>:4317` | `memtrace-ai[grpc]` |
| Any OTLP backend that takes HTTP (Jaeger, Tempo, Grafana Cloud, Honeycomb, Datadog...) | `http/protobuf` | the URL and auth header it documents | none |

```python
from memtrace import init_tracer

# Your own collector, over HTTP (the default protocol)
init_tracer(service_name="my-agent", endpoint="http://my-collector:4318")

# Your own collector, over gRPC
init_tracer(service_name="my-agent", protocol="grpc", endpoint="http://my-collector:4317")

# A hosted backend that wants a token
init_tracer(
    service_name="my-agent",
    endpoint="https://otlp.example.com",
    headers={"authorization": "Bearer <token>"},
)
```

The same with environment variables, so the code does not change between environments:

```bash
export MEMTRACE_OTLP_ENDPOINT=http://my-collector:4318
export MEMTRACE_OTLP_PROTOCOL=http/protobuf        # or grpc
export MEMTRACE_OTLP_HEADERS="authorization=Bearer <token>"
```

With the HTTP protocol the library adds `/v1/traces` to the endpoint if it is missing, as the OTLP specification says.

## Send to two places at once

Run your own collector in the middle and let it fan out. Point the library at the collector, and configure two exporters there: one for your tool and one OTLP/HTTP exporter for the MemTrace ingest endpoint, with its API key as the `authorization` header.

```yaml
exporters:
  otlphttp/memtrace:
    endpoint: https://<host>/api/v1/ingest
    headers:
      authorization: "Bearer ${env:MEMTRACE_API_KEY}"
  otlphttp/mytool:
    endpoint: https://otlp.example.com
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/memtrace, otlphttp/mytool]
```

## What you keep and what you lose

Tracing works the same everywhere: `@trace_step`, `trace_llm_call`, [conversations](./conversations), the LangChain and Pydantic AI [integrations](./integrations), and [personal data masking](./pii). Spans follow the OpenTelemetry GenAI conventions (`gen_ai.*`), so other tools can read them.

Some features are not tracing: they talk to the MemTrace platform API directly and need `MEMTRACE_API_URL` and an API key. Without the platform they are not available:

- [Offline evaluation](./evaluation) against platform datasets and sending its results.
- [User feedback](./feedback).
- The [prompt registry](./prompts).

## Check that it works

Spans are batched, so call `flush()` or `shutdown()` before a short script exits. If nothing arrives, the library never raises into your code, so check the endpoint, the protocol and the headers first: a gRPC endpoint (`:4317`) used with `http/protobuf`, or the other way round, is the most common mistake.
