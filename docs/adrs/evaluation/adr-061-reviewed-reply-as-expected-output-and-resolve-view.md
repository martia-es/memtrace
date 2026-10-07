# ADR-061: Reviewed Reply as Expected Output and a Full-Size Resolve View

* **Status**: Accepted — implemented (API + dashboard)
* **Date**: 2026-10-06
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-038](../datasets/adr-038-promote-trace-to-dataset-item.md), [ADR-050](adr-050-queue-results-and-curation-for-technical-roles.md)

## Context and Problem Statement

Promoting reviewed queue rows to a dataset (ADR-050) had a gap that confused the technical profile:

1. A reviewer's label is a **verdict** ("Concise: Yes", "Tone: 5"), not an answer. The only sources of `expectedOutput` were the text the technician typed while resolving, or the label of a categorical criterion. When reviewers agreed the agent's reply was good, there was nothing to copy: the item ended with no expected output and only reference-free evaluators (LLM judge) could score it, even though "the reply was good" is exactly a reference answer.
2. The Resolve panel mixed two different things under similar words ("final value" and "expected output") and rendered the conversation in a 320 px box inside a table row, too small to judge a reply.

## Decision Drivers

* A reply that people judged correct should be usable as the reference without retyping it.
* ADR-038 must hold: the agent's answer is never copied to `expectedOutput` **silently**; it is the person who decides.
* The verdict and the correct answer are different concepts and the UI must say so.
* Labels stay untouched (ADR-050): resolutions remain a separate layer.

## Considered Options

1. **Opt-in `useObservedOutput` on promotion** (chosen). The technician picks "the reply that was reviewed" in the promote bar; the server reads the output from the trace and uses it for rows without a typed answer.
2. **Always copy the observed output when the verdict is positive.** Rejected: "positive" is not generic (numeric, categorical), and it reintroduces the implicit copy ADR-038 rejected.
3. **Resolve client-side** by sending the reply text from the dashboard. Rejected: the dashboard would have to load every trace of the batch (up to 100); the server already reads those spans in `DatasetPromotionService`.

## Decision Outcome

* `from-traces` items accept `useObservedOutput?: boolean`. Priority in `resolveExpectedOutput`: explicit `expectedOutput` > observed output (if requested and the trace has one) > categorical label of `fromConfigId` > `null`. If the trace has no captured output the item falls through to the next source instead of failing.
* The reply is still stored in `promotedFrom.observedOutput`, so provenance does not change.
* Promote bar options: *only the correct answer I typed* (default) · *the reply that was reviewed (unless I typed one)* · *the label of "<criterion>" (unless I typed one)*. A typed answer always wins.
* Resolve opens in a **full-size modal** with two columns: the conversation (full height) on the left, each criterion's reviewer answers, **Verdict** and **Correct answer** on the right. Rubric descriptions are shown next to each criterion. `Modal` gains a `full` size and `TraceThreadPreview` a `fill` mode.
* `annotation_queue_resolutions` is unchanged: it keeps the technician's decision apart from the labels so agreement metrics (kappa, judge verdict) stay honest and the audit of who said what is preserved.

## Consequences

* The default stays conservative (nothing is copied unless chosen), so existing flows and clients are unaffected.
* The option applies to the whole batch; to mix "reply" and "typed correction" the technician types the correction on the rows that need it.
