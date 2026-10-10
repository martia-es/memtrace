# Authentication

The platform only accepts traces that carry an **API key** tied to an experiment.

1. Create a key for your experiment in the MemTrace platform (**Experiment → API keys**). Keys look like `mtk_Ab3xY9...`.
2. The plaintext is shown **once**. Store it as a secret; only its hash is kept.
3. Send it as a bearer token over OTLP/HTTP to your MemTrace endpoint (`/api/v1/ingest`).

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

A key only writes traces for its own experiment. Every trace must carry the `service.name` of the experiment the key belongs to (the `service_name` you pass to `init_tracer`, or `MEMTRACE_SERVICE_NAME`); a different one, or none, is rejected with `403` and the message tells you which name to use. Traces must be sent uncompressed or with gzip.

::: tip No `api_key` option yet
The SDK has no dedicated `api_key` argument. Pass the key with `headers`, as above.
:::
