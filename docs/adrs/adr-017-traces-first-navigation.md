# ADR-017: Traces-first navigation with optional grouping by conversation

- Status: Accepted
- Date: 2026-09-26
- Supersedes: ADR-015

## Context

ADR-015 put Conversations → Traces → Spans in one expandable list, and conversations had their own detail page with a span tree and inspector, duplicating the trace page. Navigation was confusing and unlike LangSmith, where the primary object is the trace and grouping into threads is optional.

## Decision

- **Menu > Conversaciones** (`/conversations`) lists **traces** by default. A "Agrupar por conversación" toggle (off by default, stored in the URL as `?group=conversation`) switches to one row per conversation.
- A conversation row opens `/conversations/:id`, a plain list of that conversation's traces. It has no span tree of its own.
- A trace row (from either list) opens `/traces/:id`, the only place where spans are inspected: span tree with timing bars on the left (~40%), and on the right (~60%) the selected span's input, output and metadata. The selected span lives in `?span=`.
- Breadcrumbs (Conversaciones › conversation › trace) replace the "back" button. `/spans` redirects to `/conversations`.

## Consequences

- One span inspector (`SpanInspector`) and one tree (`SpanTree`) instead of two copies; the conversation page shrinks to a table.
- No API change: `/traces`, `/conversations`, `/conversations/:id` and `/traces/:id` already cover it.
- The old span waterfall and its detail panel are removed; the tree shows timing bars, which supersedes them.
- Span-level filters (kind, model, text search) are not exposed in the list; the `/spans` endpoint remains available for a future span-level view.
