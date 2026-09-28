# Configuration

Settings can be passed to `init_tracer` or set as environment variables.

| Variable | Default | Description |
|---|---|---|
| `MEMTRACE_ENABLED` | `true` | `false` turns the SDK into a no-op |
| `MEMTRACE_SERVICE_NAME` | `default-agent` | OTel `service.name` |
| `MEMTRACE_SERVICE_VERSION`, `MEMTRACE_ENVIRONMENT` | none | Resource attributes |
| `MEMTRACE_OTLP_ENDPOINT` | `http://localhost:4317` (grpc), `:4318` (http) | Where to send traces |
| `MEMTRACE_OTLP_PROTOCOL` | `grpc` | Or `http/protobuf` (needs the `http` extra) |
| `MEMTRACE_OTLP_HEADERS` | none | `k1=v1,k2=v2` |
| `MEMTRACE_CAPTURE_CONTENT` | `false` | Store prompts, completions and tool arguments |
| `MEMTRACE_MAX_CONTENT_LENGTH` | `16384` | Truncation limit for captured content |
| `MEMTRACE_SPAN_TTL_SECONDS` | `3600` | Closes orphaned spans |
| `MEMTRACE_EXPORT_TIMEOUT_MS` | `5000` | Batch exporter timeout |
| `MEMTRACE_BATCH_MAX_QUEUE_SIZE` | `2048` | Batch queue size |
| `MEMTRACE_BATCH_SCHEDULE_DELAY_MS` | `5000` | Batch flush interval |
| `MEMTRACE_BATCH_MAX_EXPORT_SIZE` | `512` | Spans per export |

For a self-signed TLS certificate, use an `https://` endpoint and the standard `OTEL_EXPORTER_OTLP_CERTIFICATE` variable.

## Privacy and content capture

By default MemTrace records **metadata only**: names, timings, models, token counts, errors. Prompts, completions and function arguments are stored only with `MEMTRACE_CAPTURE_CONTENT=true`, truncated to `MEMTRACE_MAX_CONTENT_LENGTH`. Conversation transcripts in the dashboard require it.
