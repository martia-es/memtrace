# ADR-009: Query API Contract and `TraceRepository` Port

* **Status**: Accepted (implemented in `api/`)
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Roadmap piece 4 (query API, Next.js + TypeScript) is the only component that touches ClickHouse; piece 5 (Quasar dashboard) talks to it over HTTP/JSON and must not know the storage. The roadmap requires that storage access sit behind an own interface (`TraceRepository`) and that hierarchy reconstruction live in this piece. Nothing defines yet the endpoints, response shapes, pagination, or how the execution tree is rebuilt from `ParentSpanId`. This ADR fixes the contract before any code is written.

Constraints from the existing schema (ADR-003, `001_init_traces.sql`):

- `otel_traces` is ordered by `(ServiceName, SpanName, toDateTime(Timestamp))`, partitioned by day, TTL 30 days. A lookup by `TraceId` is **not** served by the sort key.
- `otel_traces_trace_id_ts` (fed by a materialized view) locates a trace by `TraceId`. The view aggregates **per inserted block**, so one trace can have several rows there.
- Root spans are `ParentSpanId = ''`. `Timestamp` is the span *start*.
- `SpanAttributes` is `Map(String, String)`: every value is a string (ADR-004); numbers must be cast in SQL.

## Decision Outcome

### 1. Layout and dependency rule (same principles as ADR-008)

```
api/                              Next.js (App Router), TypeScript
  src/domain/                     Trace, Span, SpanNode, metrics types; buildSpanTree(); extractGenAi()  (pure TS)
  src/application/                use cases (listTraces, getTrace, getOverview, listServices)
                                  + port TraceRepository
  src/adapters/inbound/http/      route handlers: validate (zod) → use case → DTO
  src/adapters/outbound/clickhouse/   ClickHouseTraceRepository (the only place with SQL)
  src/dependency-container.ts     composition root
```

`app/api/**/route.ts` files stay thin (parse, call use case, serialize). `domain` and `application` import neither `@clickhouse/client` nor Next.js.

### 2. Port

```ts
interface TraceRepository {
  listTraces(q: TraceListQuery): Promise<Page<TraceSummary>>;
  getTraceSpans(traceId: string): Promise<Span[] | null>;   // flat, storage order irrelevant
  getOverview(q: OverviewQuery): Promise<MetricsOverview>;
  listServices(range: TimeRange): Promise<string[]>;
}
```

The repository returns **flat, typed domain objects** (attribute `Map` already turned into a record, durations in ms). It knows SQL; it does not build trees. Tree building and GenAI attribute extraction are domain functions, testable without a database. All queries are **parameterized** (ClickHouse `query_params`); no string concatenation of user input.

### 3. HTTP contract (`/api/v1`, JSON, UTC ISO-8601 timestamps, durations in milliseconds as numbers, IDs as lowercase hex)

| Method & path | Purpose |
|---|---|
| `GET /api/v1/traces` | Paginated list of traces |
| `GET /api/v1/traces/{traceId}` | One trace with its span tree |
| `GET /api/v1/metrics/overview` | Aggregates for a range |
| `GET /api/v1/services` | Service names seen in a range (filter options) |
| `GET /api/v1/health` | Liveness (`{"status":"ok"}`), does not touch the store |
| `GET /api/v1/health/ready` | Readiness: pings ClickHouse (503 if unreachable) |

**Time range** (`from`, `to`, ISO-8601): default last 24 h; `from < to`; maximum span 30 days (the retention). Violations return 400.

#### `GET /api/v1/traces`

Query: `from`, `to`, `service`, `status` (`ok|error`, status of the root span), `hasErrors` (`true`: any span in the trace failed), `minDurationMs`, `limit` (default 50, max 200), `cursor`.

```json
{
  "items": [{
    "traceId": "8791d6e0…", "rootSpanName": "Ejecutar_Agente_Principal", "serviceName": "agente-investigador-python",
    "startTime": "2026-09-26T12:41:03.120Z", "durationMs": 412.7, "status": "ok",
    "spanCount": 3, "errorCount": 0, "totalTokens": 232
  }],
  "nextCursor": "eyJ0cyI6…"
}
```

- Listing = root spans in the range (ADR-003 §7); therefore a trace appears once its **root has been exported** (roots end last). Traces whose root was lost are not listed (known limit).
- Order: `startTime DESC, traceId DESC`. **Keyset pagination**: `cursor` is an opaque base64url of `(startTime, traceId)`; no `OFFSET`.
- Two queries: (1) the page of root spans; (2) per-trace aggregates (`spanCount`, `errorCount`, `totalTokens`) for those `traceId`s, bounded by the page's time window so daily partitions are pruned.

#### `GET /api/v1/traces/{traceId}`

```json
{
  "traceId": "8791d6e0…", "startTime": "…", "durationMs": 412.7, "status": "ok",
  "spanCount": 3, "errorCount": 1, "totalTokens": 232, "truncated": false,
  "roots": [{
    "spanId": "a13946…", "parentSpanId": null, "name": "Ejecutar_Agente_Principal",
    "kind": "agent", "serviceName": "…", "startTime": "…", "offsetMs": 0, "durationMs": 412.7,
    "status": { "code": "ok", "message": null }, "orphan": false,
    "genAi": null,
    "content": null,
    "attributes": { "gen_ai.conversation.id": "conv-1" },
    "events": [{ "name": "exception", "time": "…", "attributes": { "exception.message": "boom" } }],
    "children": [ { "…": "same shape" } ]
  }]
}
```

- `kind` = `memtrace.step_type` (falls back to `"unknown"`). `offsetMs` = start relative to the trace start, so the dashboard draws the timeline without computing it.
- `genAi` (when the span has GenAI attributes): `{ operation, provider, requestModel, responseModel, inputTokens, outputTokens, totalTokens, finishReasons, temperature, maxTokens, toolName, toolCallId }`, extracted in the domain from the `gen_ai.*` names of ADR-004; numbers parsed from strings.
- `content` (only present if it was captured, ADR-004): `{ inputMessages, outputMessages, toolArguments, toolResult, input, output }`; JSON strings are parsed, and returned as raw strings if parsing fails.
- `attributes` carries the **remaining** raw attributes, so nothing stored is hidden from the dashboard.
- `status.code` ∈ `ok | error | unset`. `roots` is an array: spans whose parent is absent (lost or not yet exported) become roots with `orphan: true`.
- Hard cap of 5 000 spans per trace; beyond it `truncated: true`.
- 404 (problem+json) when the trace does not exist in the retention window.

**Locating the trace**: `SELECT min(Start), max(End) FROM otel_traces_trace_id_ts WHERE TraceId = {id} GROUP BY TraceId` (must aggregate: the view yields several rows per trace), then read `otel_traces` with `TraceId = {id} AND Timestamp BETWEEN start AND end` so only the needed daily partitions are read.

#### `GET /api/v1/metrics/overview`

Query: `from`, `to`, `service`. `errorTraces` counts traces whose **root** span failed (same notion as the `status=error` filter of the list; use `hasErrors` there to include failed inner spans).

```json
{
  "range": { "from": "…", "to": "…", "bucketSeconds": 300 },
  "totals": { "traces": 120, "spans": 950, "errorTraces": 4, "errorRate": 0.033,
              "inputTokens": 18200, "outputTokens": 5100, "totalTokens": 23300 },
  "latencyMs": { "p50": 310.2, "p95": 1204.9, "p99": 2010.4 },
  "timeseries": [{ "bucketStart": "…", "traces": 12, "errorTraces": 1, "p95Ms": 980.1, "totalTokens": 2100 }],
  "byModel": [{ "model": "gpt-4o", "calls": 60, "inputTokens": 12000, "outputTokens": 3000, "p95Ms": 800.0 }],
  "byTool":  [{ "tool": "buscar", "calls": 44, "errors": 2, "p95Ms": 120.5 }]
}
```

- Latency percentiles are over **root spans** (end-to-end agent runs).
- `bucketSeconds` is chosen by the API from the range (target ≈ 60 buckets, minimum 60 s) and returned so the client does not guess.
- **Tokens are summed only from spans with `gen_ai.operation.name = 'chat'`** to avoid double counting when a framework also reports usage on parent spans.

#### `GET /api/v1/services`

`{ "items": ["agent-a", "agent-b"] }`: distinct service names with spans in the range.

#### Errors

RFC 7807 `application/problem+json`: `{ "type", "title", "status", "detail", "errors"? }`. 400 validation, 404 unknown trace, 503 when ClickHouse is unreachable (never leak SQL or driver messages).

### 4. Tree reconstruction (`buildSpanTree`, domain, pure)

1. Deduplicate by `spanId` (collector retries can insert a span twice); keep the first.
2. Index by `spanId`; attach each span to its parent if present, otherwise mark `orphan` and make it a root.
3. Order children by `(startTime, spanId)` for a deterministic result.
4. Guard against parent cycles (corrupt data): a span whose ancestor chain returns to itself becomes a root.
5. **Iterative**, not recursive: deeply nested agent loops must not overflow the stack.

### 5. Cross-cutting decisions

- **Versioning**: URL prefix `/v1`; only additive changes inside a version (new optional fields). Clients ignore unknown fields.
- **No auth and no CORS in Phase 1** (local only). The dashboard reaches the API through a same-origin proxy: Vite dev proxy locally, an ingress/nginx path in Kubernetes. This avoids CORS configuration entirely.
- **ClickHouse access** is read-only. Follow-up: a dedicated read-only user (via a migration/secret) instead of `default`.
- **Contract source of truth**: the response types are TypeScript interfaces in `api/src/adapters/inbound/http/contract.ts` and request parameters are validated with zod (`schemas.ts`). Generating an OpenAPI document from them is deferred until the dashboard needs it; the dashboard must import these types rather than copy them.
- **Aggregation window**: the children of a root span can start after the queried range ends, so per-trace aggregates and the `hasErrors` filter look up to 24 h past the range end (`TRACE_WINDOW_MS`). Traces longer than 24 h are out of scope.
- **Store protection** (found during integration tests, see Consequences): the ClickHouse client uses `readonly=2` (no writes, but per-query settings allowed), caps `max_threads` per query (default 2) and limits concurrent queries per API process (default 3). Configurable with `CLICKHOUSE_QUERY_MAX_THREADS` and `CLICKHOUSE_MAX_CONCURRENT_QUERIES`.

## Consequences

- **Positive**: the dashboard depends on a small, stable JSON contract; SQL is confined to one adapter and swappable; tree logic and GenAI extraction are unit-testable; keyset pagination stays stable under concurrent inserts.
- **Negative**:
  - **The local ClickHouse has little thread headroom** (kind caps each container at 307 PIDs). Parallel queries exhausted the default ClickHouse during integration tests; ADR-010 reduces its background threads (~300 → ~140) and this API additionally limits per-query threads and concurrency.
  - Listing shows only traces with an exported root, and a trace with a lost root is invisible in the list (reachable by ID only).
  - `status` (root) and `hasErrors` (any span) are different notions; the UI must show both or it will mislead.
  - Listing without a `service` filter cannot use the sort key for ordering; acceptable at local volume, and ADR-003 already anticipates a projection/materialized view via a new migration.
  - Attribute values are strings in ClickHouse, so numeric aggregations pay a cast; a typed column for hot attributes (tokens, model) may be added later by migration.
  - Overview quantiles are computed at query time on raw spans; pre-aggregation is deferred until measured.
