# Query API

The dashboard's only data source. HTTP/JSON, versioned under `/api/v1`; within a version only additive changes are made. Errors use `application/problem+json` ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)). Requests need a signed-in session and are authorized per experiment.

## Experiment data

All under `/api/v1/experiments/{experimentId}`:

| Endpoint | Description |
|---|---|
| `GET /traces` | Paginated trace list. Params: `from`, `to`, `service`, `status`, `hasErrors`, `minDurationMs`, `limit`, `cursor` |
| `GET /traces/{traceId}` | A trace with its span tree |
| `GET /spans` | Flat, paginated span list |
| `GET /conversations` | Paginated conversations |
| `GET /conversations/{conversationId}` | Summary and turns in chronological order |
| `GET /conversations/{conversationId}/transcript` | User/assistant messages per turn (needs captured content) |
| `GET /conversations/{conversationId}/tree` | Span tree of each turn |
| `GET /metrics/overview` | Totals, latency, time series, tokens per model, tools |

Lists are cursor-paginated: pass the `nextCursor` of a response as `cursor` to get the next page.

## Evaluation (ADR-028)

Also under `/api/v1/experiments/{experimentId}`. Unlike every other endpoint on this page, these also accept an agent API key (`Authorization: Bearer <key>`) instead of a session — `memtrace.eval` (see [Offline evaluation](/library/evaluation)) calls them directly:

| Endpoint | Auth | Description |
|---|---|---|
| `GET, POST /datasets` | session | List / create datasets |
| `GET, POST /datasets/{datasetId}/items` | session or API key | List items, or add items to a dataset |
| `GET, POST /datasets/{datasetId}/runs` | session or API key | List runs, or submit a finished run (`memtrace.eval.run_experiment`'s default sink posts here) |
| `GET /datasets/{datasetId}/runs/{runId}` | session | Run detail: metadata plus every item's scores |

An agent API key only resolves items/runs for the experiment it belongs to — the same key used for OTLP ingestion works here, no separate credential.

## Cross-experiment usage

| Endpoint | Description |
|---|---|
| `GET /experiments/usage` | Token totals per experiment, for every experiment you can access. Params: `from`, `to` |

Unlike the endpoints above, this one isn't scoped to a single `{experimentId}` — it returns one row per experiment you have access to, for the cost comparison view on the dashboard's Metrics page (see ADR-023, `docs/adrs/adr-023-cross-experiment-usage-endpoint.md`, for why this is the one exception to per-experiment scoping).

## Identity

| Endpoint | Description |
|---|---|
| `GET /me` | Current user |
| `GET, POST /organizations` | List / create organizations |
| `GET /experiments` | Experiments you can access |
| `POST /organizations/{organizationId}/experiments` | Create an experiment (`org_admin`) |
| `GET, POST /organizations/{organizationId}/members` | List / invite `org_admin`s |
| `GET, POST /experiments/{experimentId}/members` | List / invite experiment members |
| `GET, POST /experiments/{experimentId}/api-keys` | List / create agent API keys |
| `DELETE /experiments/{experimentId}/api-keys/{keyId}` | Revoke a key |

## Ingest and health

| Endpoint | Description |
|---|---|
| `POST /ingest/v1/traces` | OTLP/HTTP gateway; requires an agent API key (see [Authentication](/library/authentication)) |
| `GET /health`, `GET /health/ready` | Liveness / readiness |
