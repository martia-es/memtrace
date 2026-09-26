# ADR-015: Unified Hierarchy View (Conversations → Traces → Spans)

**Status:** Accepted
**Date:** 2026-09-26
**Author:** Marta García

## Problem

The dashboard UI was confusing users with two separate tabs/views:
- **Spans tab**: Showed conversaciones grouped or individual spans (two conflicting structures)
- **Traces tab**: Showed individual traces

Users couldn't distinguish between "spans" and "traces" because both refer to related but different concepts without a clear hierarchy. The dual-tab design didn't reflect the actual relationship between data: a Conversation contains multiple Traces (turns), and each Trace contains multiple Spans.

## Solution

Replace the two-tab structure with a **single unified hierarchical view**:

```
Conversación (level 1)
├── Turno 1 / Traza 1 (level 2)
│   ├── Span A
│   ├── Span B
│   └── Span C
└── Turno 2 / Traza 2 (level 2)
    ├── Span D
    ├── Span E
    └── Span F
```

Each level is expandable/collapsible:
- Conversations expand to show their Traces (turns)
- Traces expand to show their Spans

## Implementation

- **Consolidated SpansPage**: Now handles all three hierarchy levels instead of just spans
- **Removed TracesPage**: No longer needed; traces are accessible within conversations
- **Updated router**: Removed `/traces` route; all data accessible from `/spans`
- **Simplified filters**: Removed span-level filters (kind, model, status) since the view is now conversation-centric; kept service filter for cross-agent queries

## Benefits

1. **Clarity**: Obvious hierarchy makes the relationship between data obvious
2. **Intuitive**: Mirrors how users think about conversations (sessions) → interactions (traces) → operations (spans)
3. **Less cognitive load**: Single entry point (conversations) vs. deciding between tabs
4. **Better data exploration**: Users can drill down naturally without context switching

## Trade-offs

- Lost the ability to filter spans directly by kind/model/status at the top level
  - _Mitigation_: Users can open a trace detail view to filter or search spans within that trace
- Slightly more clicking to view all spans in a time range
  - _Mitigation_: Rare use case; service filter still available for queries across conversations

## Terminology Clarification

In MemTrace:
- **Conversation**: A session of interactions (multiple turns) grouped by `gen_ai.conversation.id`
- **Trace**: A single execution with a root span; typically one trace per conversation turn (ADR-012)
- **Span**: A unit of work within a trace (LLM call, tool execution, etc.)

The old "Spans tab" was misleading because it showed conversaciones (a higher-level concept), not individual spans. This ADR resolves that confusion.
