# ADR-012: Unified Span Tree View for a Conversation

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The dashboard only ever shows one trace's span tree at a time (`TraceDetailPage`, ADR-009). A conversation's turns (`ConversationDetailPage`) are shown as a flat summary table; to see how a multi-turn agent run actually executed, a user has to open each turn's trace separately and lose the surrounding context. LangSmith's "thread" view solves this by stacking every run's span tree under one scrollable panel, numbered in order, with a shared summary header and a single inspector for whatever span is selected. We want the same for a MemTrace conversation.

## Decision Drivers

- Reuse the existing per-trace tree-building code (`buildTraceDetail`, `SpanTree.vue`) instead of inventing a cross-trace merged tree — each turn keeps its own tree, only the *page* stacks them.
- Keep the query API's per-trace-detail contract (ADR-009) as the unit of truth; add capability, don't change existing endpoints.
- Bound the cost of loading N trees at once: one HTTP round trip, one ClickHouse query, with per-trace truncation so one abnormally large trace can't starve the others.

## Decision Outcome

**New batch endpoint**: `GET /api/v1/conversations/:id/tree`, paginated exactly like `GET /api/v1/conversations/:id` (same `limit`/`cursor`, same turn order), returning `{ items: TraceDetailResponse[], nextCursor }` — one full span tree per turn.

**API implementation**:
1. `TraceQueryService.getConversationTraceTrees` reuses `listTraces({ conversationId, order: "asc" })` to get the page of turns, then fetches spans for exactly those `traceId`s in one call to a new repository method, and builds one `TraceDetail` per turn with the existing `buildTraceDetail`.
2. `ClickHouseTraceRepository.getTraceSpansForTraces(traceIds, maxSpansPerTrace)` fetches spans for several traces in a single query (`TraceId IN [...]`, bounded by the traces' combined start/end window from the trace-id index), and uses `QUALIFY row_number() OVER (PARTITION BY TraceId ORDER BY Timestamp) <= maxSpansPerTrace` so each trace is truncated independently — a single huge run cannot crowd out the query's span budget for the others. `maxSpansPerTrace` is lower than the single-trace limit (`MAX_SPANS_PER_TRACE_IN_TREE = 2000` vs `MAX_SPANS_PER_TRACE = 5000`) since a conversation view loads several trees at once.
3. A turn whose spans disappeared between `listTraces` and the spans query (edge case, e.g. retention sweep) is silently dropped from `items` rather than erroring the whole response.

**Dashboard**: `ConversationDetailPage` gets a `Table / Tree` toggle (URL query param `?view=tree`, so it's linkable and survives refresh). Tree mode renders the new `ConversationTree.vue` component — one numbered, collapsible entry per turn, each wrapping the existing `SpanTree.vue` — next to a shared `SpanInspector.vue`, matching `TraceDetailPage`'s two-column layout. Selecting a span in any turn's tree updates the shared inspector; no cross-trace tree-merging logic was written client-side either.

## Considered Alternatives

- **N client-side calls to the existing `GET /traces/:id`.** Rejected: turns a page load into N sequential/parallel round trips and N ClickHouse queries instead of one; gets worse as conversations grow longer.
- **A real merged tree across traces** (single root, turns as synthetic children). Rejected: traces in a conversation don't share a root span — there is nothing to merge them under — and LangSmith's own thread view doesn't do this either; it stacks independent runs.
- **Extend `ConversationDetailResponse.turns` to carry full trees inline.** Rejected: that response is also used for the flat table view, which never needs full span trees (240-char previews are enough there) — bundling them would bloat every conversation-detail request.

## Consequences

- **Positive**: reuses every existing tree-building and rendering building block; one new endpoint, one new repository query, one new Vue component.
- **Negative**: a second way to reach "the same span" exists in the dashboard (`TraceDetailPage` route vs. the inline tree), so the two must be kept visually consistent as `SpanTree.vue`/`SpanInspector.vue` evolve — they are the same components, not copies, which keeps this cheap.
- **Negative**: `getTraceSpansForTraces` relies on ClickHouse window functions (`QUALIFY` + `row_number() OVER`), supported since ClickHouse ≥ 23.5; the cluster runs 23.8 (ADR-002/ADR-005), so this is not a current constraint, but it is a new minimum-version dependency worth remembering if ClickHouse is ever downgraded.
