# ADR-012: Grouping Traces into Conversations

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

An agent conversation is many traces (one per turn). The SDK already tags spans with the standard attribute `gen_ai.conversation.id` (`memtrace.session(...)`, LangChain `thread_id` / `session_id` / `conversation_id`), but the API and the dashboard only list individual traces. Users need to see, browse and compare whole conversations.

## Decision Outcome

1. **A conversation is the set of traces (turns) whose spans carry the same `gen_ai.conversation.id`.** Each trace is one turn. Traces without the attribute are simply not part of any conversation; they stay in the trace list.
2. **Storage: a real column** (migration `002_conversation_id.sql`): `ConversationId String MATERIALIZED SpanAttributes['gen_ai.conversation.id']` plus a bloom-filter index. Reading the id from the attribute map forces ClickHouse to read every span's whole map; measured on the dev data, grouping root spans by the column reads **8.6× fewer bytes** (30 776 → 3 574) than grouping by the map. Being `MATERIALIZED`, the Collector's explicit-column inserts are unaffected (verified: new spans get the value, no exporter errors). Existing parts were rewritten with `MATERIALIZE COLUMN` / `MATERIALIZE INDEX`. Rolling back = drop the column and the index.
3. **Key = the id alone** (not service + id): multi-agent systems share a conversation across services, so the summary lists the services involved. Ids must be unique per conversation and free of personal data (they appear in URLs and in the UI).
4. **A conversation's spans are those whose `ConversationId` matches.** The SDK writes the attribute on every span opened inside a session, so turn counts, tokens and errors are computed in one pass over that column. Spans created by third-party instrumentation without the attribute are not counted.
5. **Which conversations are listed** is decided by the time range (a conversation appears if one of its turns *started* in the range); **its figures cover its whole retained history** (30 days), so a conversation that crosses the range boundary is not shown truncated. Order: last activity (latest turn start in the range) descending, keyset pagination.
6. **No single "status"**: a conversation reports `errorTurns` (turns whose root failed, the same notion as `status=error` in the trace list) and `failedSpans` (any failed span). The `hasErrors` filter means "contains a failed span".
7. **Contract (additive inside `/api/v1`, ADR-009)**:

| Endpoint | |
|---|---|
| `GET /conversations` | `from, to, service, hasErrors, limit, cursor` → `{ items: ConversationSummary[], nextCursor }` |
| `GET /conversations/{id}` | summary + `turns` = paginated traces in **chronological** order (`limit, cursor`); 404 if unknown |
| `GET /traces` | new filter `conversationId`; every `TraceSummary` gains `conversationId` (nullable) |
| `GET /traces/{id}` | response gains `conversationId` (nullable) |
| `GET /metrics/overview` | `totals.conversations` |

```json
{ "conversationId": "conversacion-2", "serviceNames": ["asistente-soporte"],
  "startTime": "…", "lastActivity": "…", "turnCount": 3, "errorTurns": 0,
  "failedSpans": 1, "totalTokens": 5200, "activeMs": 2210.4 }
```

`startTime` = first span start, `lastActivity` = end of the last turn, `activeMs` = sum of the turns' root durations (time working, not wall-clock, which includes the user's think time).

8. **Query shape** (both hexagonal layers, ADR-009): `TraceRepository` gains `listConversations`, `getConversation`, and `listTraces` gains `conversationId` and `order`. Conversation list = two queries: page of ids (roots in range grouped by `ConversationId`, keyset on `(lastActivity, id)`), then aggregates for those ids over the retention window.
9. **Dashboard**: a "Conversaciones" section (list with the same filters and live refresh) and a conversation view with the chronological turns and the idle gap between them; trace detail and trace list link to their conversation.

## Consequences

- **Positive**: conversation queries never touch the attribute map (except tokens), stay cheap as volume grows, and need no change to the SDK or the contract of existing endpoints.
- **Negative**:
  - The migration rewrites existing parts once (background mutations; fine at the 30-day retention).
  - A conversation only exists for traces whose turns were tagged: forgetting `session(...)` means no grouping, silently. The docs and the example must show it.
  - Two agents reusing the same id are merged into one conversation.
  - Tokens still read the attribute map of chat spans (as in the trace list).
  - The transcript (user/assistant messages per turn) needs captured content (ADR-004) and per-turn span fetches; deferred.
  - A conversation lasting longer than the 24 h aggregation window of ADR-009 can still be listed, but a `hasErrors` filter only sees failed spans within that window.
