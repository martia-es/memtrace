# Authentication

A platform with access control only accepts traces that carry an **API key** tied to an experiment.

1. An `admin` of the experiment (or an `org_admin`) creates a key in the dashboard, or with `POST /api/v1/experiments/{experimentId}/api-keys`. Keys look like `mtk_Ab3xY9...`.
2. The plaintext is shown **once**. Store it as a secret; only its hash is kept.
3. Send it as a bearer token over OTLP/HTTP, to the API's ingest gateway (`/api/v1/ingest`), which validates it and forwards to the collector.

```python
from memtrace import init_tracer

init_tracer(
    service_name="my-agent",
    protocol="http/protobuf",                 # needs memtrace-ai[http]
    endpoint="https://<your-host>/api/v1/ingest",
    headers={"authorization": "Bearer mtk_Ab3xY9..."},
)
```

Or with environment variables:

```bash
export MEMTRACE_OTLP_PROTOCOL=http/protobuf
export MEMTRACE_OTLP_ENDPOINT=https://<your-host>/api/v1/ingest
export MEMTRACE_OTLP_HEADERS="authorization=Bearer mtk_Ab3xY9..."
```

An invalid or revoked key is rejected with `401`.

::: warning Current limitation
The gateway checks that the key is valid, not that the traces' `service.name` matches the key's experiment. Also, the SDK has no dedicated `api_key` option yet; use `headers` as above.
:::
