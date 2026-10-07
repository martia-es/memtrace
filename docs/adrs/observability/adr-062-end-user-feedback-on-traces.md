# ADR-062: End-User Feedback on Traces

* **Status**: Accepted — implemented
* **Date**: 2026-10-06
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-037](../evaluation/adr-037-human-annotations-storage-and-api.md), [ADR-049](../api/adr-049-conversation-title-cost-and-low-rated-traces.md), [ADR-055](../governance/adr-055-agent-chat-endpoint-and-proxy.md)

## Context and Problem Statement

MemTrace knows what reviewers think of an answer (annotations, ADR-037) and what automatic evaluators think (scores), but not what the **people using the agent** think. A 👍/👎 on each answer is the cheapest, most honest quality signal, and comparing it with the reviewers' verdict shows where the review rubric misses what users care about.

Three questions had to be settled: where to store the vote, what it is attached to, and who is allowed to write it.

## Decision Outcome

### 1. A new ClickHouse table, `user_feedback`, not `annotations` and not PostgreSQL

`migrations/clickhouse/010_user_feedback.sql`, `ReplacingMergeTree(CreatedAt, IsDeleted)`, key `(ServiceName, TraceId, SpanId, EndUserId)`, no TTL.

* **Not `annotations`.** An annotation is identified by `AnnotatorId` (a `users.id` from PostgreSQL) and a rubric `ConfigId`. An end user is not a MemTrace member and there is no rubric. Forcing them in would blur the model of ADR-037 and let end-user votes leak into agreement metrics.
* **ClickHouse, not PostgreSQL.** The volume follows the agent's traffic, not the number of MemTrace users, and every read joins with traces: lists show a column per row, the summary aggregates by day. Same store as traces, scores and annotations keeps those reads in one database. PostgreSQL would also work at low volume (real `UPDATE`, `UNIQUE`), but then list columns and the satisfaction chart need application-side joins. Edits use the same tombstone pattern as annotations.

### 2. The key is the `TraceId`, with `SpanId` optional

Every user message produces a trace, so a vote on "that answer" is a vote on that trace. This is what Langfuse (score on `traceId`) and LangSmith (feedback on `run_id` plus `trace_id`) do. A `message_id` is an id of the *application*, not of the observation, so it is kept only as optional metadata (`ExternalMessageId`); the agent's own UI can still join on it. A regenerated answer is a new trace and gets its own vote. `SpanId` lets a vote target one step.

`EndUserId` is a pseudonym chosen by the agent. The same person voting again on the same answer replaces their vote; without it the vote is anonymous and deduplicated per trace. With a dashboard session the voter is `memtrace-user:<userId>`.

### 3. Writes accept the agent API key

`POST` / `DELETE /api/v1/experiments/:id/traces/:traceId/feedback` accept an agent API key as well as a session (`annotation:write`), like the dataset-run endpoints (ADR-028). The agent's server calls MemTrace; the end user's browser never holds the key. The service rejects a trace that exists under **another** `ServiceName` (`404`, as in ADR-037) and validates `rating ∈ {1, -1}`. A trace that does not exist **yet** is accepted, unlike ADR-037: a person votes as soon as they see the answer and the SDK exports spans in batches, so the vote usually arrives first. This leaks nothing across tenants because votes are written and read only under the sender's `ServiceName`.

The SDK wraps it: `memtrace.feedback(trace_id, "up" | "down", ...)`, `retract_feedback`, and `current_trace_id()` so the agent can return the trace id to its UI.

### 4. The chat contract learns where the trace id is

ADR-055 lets each agent declare the JSON keys of its chat. A new optional `chat_trace_id_field` (`experiments`, migration `postgres/028`; dotted path allowed) tells the proxy where the answer carries its trace id. The proxy returns `traceId` only if it looks like an OTel trace id (32 hex). The dashboard's "Talk" panel shows 👍/👎 under an answer only when it has a `traceId`.

### 5. "Aligned" means the user and the human review agree

For a trace with votes, the majority vote is compared with the verdict of its **human annotations** (a low label per ADR-049 counts as bad; categorical labels do not count). Equal verdicts are `aligned`, opposite are `misaligned`, no labels or tied votes are `unknown`. Automatic scores are **not** used: they exist only for traces that are dataset-run items, while end-user votes come from live traffic.

### API

```
POST   /traces/:traceId/feedback    { rating, comment?, spanId?, endUserId?, externalMessageId? }  session or API key
GET    /traces/:traceId/feedback    { votes, alignment }
DELETE /traces/:traceId/feedback?endUserId=&spanId=                                               session or API key
GET    /feedback/ratings?traceIds=|conversationIds=   -> { items: [{ id, up, down }] }
GET    /feedback/overview?from=&to=                   -> { summary, days, alignment, recentDown }
```

## Consequences

* **Positive**: a user-quality signal next to the reviewers' one, visible per trace (colored strip, list column) and in the summary (satisfaction KPI, *Needs attention*), without touching the annotation model.
* **Positive**: the agent integrates with one function call; no key in the browser.
* **Negative**: one more table and one more write path (`api_writer` gets `INSERT` on `user_feedback`); `FINAL` on reads, as with annotations.
* **Negative**: `EndUserId` is trusted. An agent can vote as any pseudonym; this measures sentiment, it is not an audit trail.
* **Negative**: alignment is only as good as the human coverage: with few annotated traces most votes are `unknown`. The overview computes it over the latest 500 votes of the range, not all of them.
* **Not covered**: free-text comment moderation, a retention policy for `Comment` (it may hold personal data; same tenant boundary as annotations), vote counts per deployment/version, and alerts on satisfaction drops.
