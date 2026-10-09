# ADR-077: Pick a failure to fix from four existing signals

## Status

Accepted

## Context

[ADR-072](adr-072-drafts-and-fixes-from-failures.md) made "Fix a failure" start from a trace id. In practice the person had to leave the prompt, find a failed trace elsewhere, copy its id and come back. A failure is also more than an error: an evaluator can score a reply low, a reviewer can label it "no" and the end user can vote 👎 on a reply that raised no exception.

MemTrace already stores all four signals, in three stores:

| Signal | Where it lives |
|---|---|
| A step failed | ClickHouse spans (`StatusCode = error`) |
| Low evaluator score | ClickHouse `eval_scores`, linked to a trace through `eval_items.TraceId` |
| Low human label | ClickHouse `annotations`, judged against the PostgreSQL score configs ([ADR-049](../api/adr-049-conversation-title-cost-and-low-rated-traces.md)) |
| 👎 from the end user | ClickHouse `user_feedback` ([ADR-062](../observability/adr-062-end-user-feedback-on-traces.md)) |

## Decision

**A new read endpoint lists the recent failures of a prompt, each with its reasons.** `GET /experiments/{id}/prompts/{promptId}/failures?from=&to=` (same permissions as Evidence: `experiment:read` and `prompt:read`).

- The unit is a **trace that used the prompt** (any version), newest first. The service takes the latest 300 traces of the range and asks each store about those ids in a single batch query, so the cost does not grow with the number of failures.
- A trace is a failure if it has **at least one** reason: `error`, `low_score`, `human_low` or `user_dislike`. A trace keeps every reason it has. The response carries the failures (up to 100), how many traces were examined (`scanned`) and a count per reason, so the screen never claims more than it looked at.
- **What counts as low** reuses existing rules instead of inventing new ones:
  - human label: `isLowRating` (ADR-049), through `AnnotationService.listRatings`;
  - evaluator score: a `boolean` false, or a `numeric` below 0.5 on the 0-1 scale of the built-in evaluators and judges. Categorical scores never count (no order). Per-evaluator targets (ADR-060) are not used: they judge a whole run, not one item.
- A new port method, `ScoreRepository.listScoresByTraces`, batches what `listScoresByTrace` already did for one trace.
- The dashboard shows the list inside the **Fix a failure** tab, with a filter per reason (only those that exist), reason labels on every row and "Show more" by tens. Choosing a row loads it in place. Pasting a trace id remains as a fallback, and the "Fix with a prompt change" button on a trace is unchanged.

## Why not the alternatives

- **Filter in the browser** with the existing trace, rating and feedback endpoints: each is paginated and unfiltered by prompt, so the intersection would be wrong or need many requests.
- **One ClickHouse query joining everything**: the human-label rule needs the PostgreSQL score configs, which ClickHouse cannot see.
- **Only errors** (first version of this feature): hides exactly the failures a prompt change fixes best, such as a wrong answer that raised no error.

## Consequences

- The list covers the **latest 300 traces** of the prompt in the range, not all history; the UI says how many it examined. A rarer reason on older traces can be missed.
- Traces from the playground are not excluded here (they are excluded from Evidence); a failing playground run can appear in the list.
- Online evaluation is still out of scope, so `low_score` only appears for traces that came from an offline evaluation run.
- No schema change and no new store.
