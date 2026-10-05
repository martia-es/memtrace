# ADR-049: Conversation Title and Cost, and Low-Rated Traces for "Needs attention"

* **Status**: Accepted
* **Date**: 2026-10-04
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The redesigned dashboard ([ADR-048](../ui/adr-048-mediterranean-design-system-and-simplified-navigation.md)) lists conversations and flags what needs attention. Two things it needs were not in the query API:

1. **A readable name and a cost per conversation.** The list identified a conversation only by its id, and the cost was visible per span and per model but not per conversation.
2. **Traces that reviewers rated low.** "Needs attention" could show errors, failing tools and review backlog, but not quality problems found by people.

No new user input is captured: both come from data MemTrace already stores.

## Decision Outcome

### 1. `title` and `costUsd` on `ConversationSummaryDto`

- `title` is the user's **first message** of the conversation, whitespace-collapsed and cut at 120 characters. It is read from `gen_ai.input.messages` of the earliest chat span (`argMin` by timestamp) and parsed with the same `parseMessages` / `lastOf(…, "user")` used by the transcript, so the notion of "the user's message" is the same everywhere. `null` when the agent did not capture content (ADR-004).
- `costUsd` sums, per model, the chat tokens of the conversation priced from the catalog. Following [ADR-025](../pricing/adr-025-model-pricing-catalog-sync.md), the repository never knows prices: it returns tokens per model (`getConversationUsage`) and `TraceQueryService` applies `costOf`. Models without a known price are left out of the sum; the result is `null` when none has a price, so a partial figure is never shown as if it were complete.
- Two grouped queries run in parallel for the whole page (not one per conversation) and only over the conversation ids already selected. The `ConversationSummary` the repository returns is unchanged; the service adds the two fields (`ConversationListItem`), and the detail endpoint returns the same fields as the list.

### 2. Low-rated traces from existing human labels

`GET /experiments/{id}/annotations/low-rated?from&to` returns `{ count, items }` (newest first, at most 10 items) for traces whose **whole-trace** human labels contain at least one "low" value in the range:

| Data type | Counts as low |
|-----------|---------------|
| boolean | `false` |
| numeric | strictly below the midpoint of the config's `[min, max]` (so a 1–5 scale flags 1 and 2, not 3) |
| categorical | never: categories have no order unless the rubric says so |

The rule is a pure function (`isLowRating`) so it can be changed in one place. The service reads the most recent 2,000 labels of the range from the existing `annotations` table (`FINAL`, not retracted) and the experiment's score configs, and counts **distinct traces**, so two reviewers rating the same trace do not inflate the number. Any experiment member can read it, like the rest of the annotation reads.

### 3. English for the whole dashboard

Number, date and relative-time formatting moved from `es-ES` to `en-US` (`1,284`, `Sep 26, 13:24:00`, `5 min ago`; the year appears only when it is not the current one). The few Spanish UI strings were translated. The code comments and the project's internal documents stay in Spanish.

## Consequences

- **Positive**: no new storage, no new capture, and the dashboard needs no extra request per row.
- **Positive**: the cost is consistent with the rest of the product because it uses the same catalog and function.
- **Negative**: the title needs captured content; without it the list falls back to the id.
- **Negative**: "low" is a heuristic over human labels, not a user-satisfaction signal. Ratings from end users would need their own capture and ADR.
- **Negative**: the low-rated scan is capped at 2,000 labels per request. Beyond that, older labels in the range are not counted.
