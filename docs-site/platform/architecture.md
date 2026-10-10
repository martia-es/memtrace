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

## Where data is stored

| Store | What it holds | Personal data from your agents? |
|---|---|---|
| ClickHouse | Traces, automatic scores, human annotations, and the per-item results of evaluation runs | **Yes**, if content capture is on. Anonymize in the SDK ([Anonymizing personal data](/library/pii)); the Collector also masks fixed-format personal data before storage ([Data protection](/platform/data-protection)) |
| PostgreSQL | Users, organizations, roles, hashed API keys, datasets and their versions, score configs, review queues | Dataset items are long-lived and are written by people, so keep personal data out of them too |

Retention: traces are kept for 30 days, and the text of evaluation run items for 180 days. Details are in [Datasets & offline evals](/platform/evaluation#retention).

Trace attributes follow the OpenTelemetry [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), so traces from other libraries that emit `gen_ai.*` attributes work too.

## Topic extraction (analytics enrichment)

A scheduled worker (`analytics/topic_extraction`) reads AI responses from ClickHouse and assigns each one a topic, using a local embedding + clustering model (BERTopic) — no calls to an external LLM. It writes into its own table (`span_topics`), separate from the raw trace data, so it can be recomputed without touching `otel_traces`. This runs asynchronously on a schedule, so topics for very recent responses may not appear immediately.
