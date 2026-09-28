# Architecture

```
WRITE   agent + SDK ──OTLP──► Collector ──batch──► ClickHouse
READ    Dashboard ◄──HTTP/JSON──► Query API ──────► ClickHouse
                                       └──────────► PostgreSQL (identity)
```

Each piece exposes a stable contract to its neighbor and hides its own technology:

- The **SDK never knows the store.** It speaks only OTLP, the OpenTelemetry standard.
- The **dashboard never knows the store.** It speaks only the query API's HTTP/JSON contract.
- **Writing and reading are separate processes**, because their load profiles differ: ingestion is continuous, queries are on-demand.
- The **query API owns all storage knowledge** (SQL, hierarchy reconstruction). Swapping the analytical store means rewriting it internally, not changing the contract.
- **Identity lives in PostgreSQL**, separate from ClickHouse: users and roles are transactional data, traces are high-volume analytics.

Trace attributes follow the OpenTelemetry [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), so traces from other libraries that emit `gen_ai.*` attributes work too.

## Topic extraction (analytics enrichment)

A scheduled worker (`analytics/topic_extraction`) reads AI responses from ClickHouse and assigns each one a topic, using a local embedding + clustering model (BERTopic) — no calls to an external LLM. It writes into its own table (`span_topics`), separate from the raw trace data, so it can be recomputed without touching `otel_traces`. This runs asynchronously on a schedule, so topics for very recent responses may not appear immediately.
