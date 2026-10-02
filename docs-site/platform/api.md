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

## Evaluation (ADR-028, ADR-031, ADR-032)

Also under `/api/v1/experiments/{experimentId}`. Unlike every other endpoint on this page, the ones marked "session or API key" also accept an agent API key (`Authorization: Bearer <key>`) instead of a session — `memtrace.eval` (see [Offline evaluation](/library/evaluation)) calls them directly:

| Endpoint | Auth | Description |
|---|---|---|
| `GET, POST /datasets` | session | List / create datasets |
| `GET /datasets/{datasetId}` | session | Dataset detail: name, run count, version count |
| `DELETE /datasets/{datasetId}` | session | Delete a dataset and, in cascade, its versions/items/runs |
| `GET, POST /datasets/{datasetId}/items` | session or API key | Items of the dataset's **latest version** (resolved server-side) — the only items endpoint the SDK calls. `POST` adds items and bumps the **major** version automatically (ADR-032) |
| `PUT, DELETE /datasets/{datasetId}/items/{itemId}` | session | Edit (bumps **minor**) or delete (bumps **major**) a single item — each one creates its own version automatically, there is no separate "create version" call |
| `GET /datasets/{datasetId}/versions` | session | Read-only version history: `major.minor`, an auto-generated description of what changed, who, and when |
| `GET /datasets/{datasetId}/versions/{versionId}/items` | session | That version's full item set, including tombstones of items deleted in it (`deletedByEmail`/`deletedAt`) — read-only, for inspecting what changed |
| `GET, POST /datasets/{datasetId}/runs` | session or API key | List runs, or submit a finished run (`memtrace.eval.run_experiment`'s default sink posts here) — the run is pinned to the dataset's latest version at that moment |
| `GET /datasets/{datasetId}/runs/{runId}` | session | Run detail: metadata plus every item's scores |
| `GET /runs` | session | All runs of every dataset in the experiment, newest first (backs the dashboard's Runs view) |

An agent API key only resolves items/runs for the experiment it belongs to — the same key used for OTLP ingestion works here, no separate credential. The SDK never sends or receives a version id: versioning is resolved entirely server-side, and happens automatically on every item change (ADR-031, ADR-032), so `memtrace.eval`'s public surface never changes.

## Cross-experiment usage

| Endpoint | Description |
|---|---|
| `GET /experiments/usage` | Token totals per experiment, for every experiment you can access. Params: `from`, `to` |

Unlike the endpoints above, this one isn't scoped to a single `{experimentId}` — it returns one row per experiment you have access to, for the cost comparison view on the dashboard's Metrics page (see ADR-023, `docs/adrs/api/adr-023-cross-experiment-usage-endpoint.md`, for why this is the one exception to per-experiment scoping).

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
