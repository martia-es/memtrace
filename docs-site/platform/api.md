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
