# ADR-042: Offline Evaluation Storage Model — Known Limitations and Target Direction

* **Status**: Proposed — documents limitations, nothing here is implemented
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Relates to**: [ADR-028](adr-028-offline-evaluation-decoupled-sdk.md) (original model), [ADR-034](adr-034-run-records-dataset-version-and-uploads-incrementally.md) (incremental uploads), [ADR-043](adr-043-record-judge-identity-on-scores.md) (judge identity)

## Context and Problem Statement

Offline evaluation results are stored in two places (ADR-028):

* **PostgreSQL** `dataset_runs` (id, dataset, dataset version, name, `item_count`, `status`, `created_at`): run metadata only.
* **ClickHouse** `memtrace.scores`: **one row per (run, item, evaluator)**, ordered by `(ServiceName, DatasetRunId, ItemIndex, Name)`, with `Value` as a serialized `String` and the item's `Input` / `Output` / `ExpectedOutput` / `Error` stored on *every* row.

This was the right size for "a few scores per item" and it serves the current dashboard (run list, run detail, run-over-run charts). The product direction (offline evals dashboard in Metrics, run comparison, latency, many more metrics, RAG chunk inspection) goes beyond what this shape can hold cleanly. This ADR records the limits so future work does not grow on top of them unknowingly. It does **not** change anything yet.

## Limitations

| # | Limitation | Consequence for the planned features |
|---|---|---|
| 1 | Item text (`Input`/`Output`/`ExpectedOutput`/`Error`) is duplicated on every evaluator row | Storage grows with `items × evaluators × text size`. 10 evaluators = text stored 10×. Cheap evaluators become expensive to add. |
| 2 | `Value` is a `String`; every aggregation does `toFloat64OrNull(Value)` | No typed column to index/compress; numeric analytics (percentiles, histograms, correlation between metrics) are awkward and slower. |
| 3 | No per-item measurements: **latency, tokens, cost are not recorded** (the SDK does not time `task`) | The dashboard cannot show latency per run natively. Today it can only be approximated through `TraceId` → trace duration, and only if the user traced the agent *and* the id was captured. |
| 4 | No place for **RAG retrieved chunks** (1:N per item: rank, source, text, retrieval score) | Cannot be queried; stuffing them into `Output` makes retrieval metrics (recall@k, precision@k, MRR) and "which chunk caused this failure" impossible. |
| 5 | Item and score are the same row | "Item" facts (output, error, latency) and "evaluation" facts (verdicts) have different cardinality; mixing them forces `_no_score` placeholder rows for items without scores (see `placeholderScore`). |
| 6 | Run-level aggregates are computed on read with `FINAL` over the whole run | Fine at hundreds of items; run lists with many runs × many items get expensive. No materialized per-run aggregate. |
| 7 | No partitioning or TTL | Cannot expire heavy text columns independently of the (small, valuable) numeric results. |
| 8 | Judge identity is per score (ADR-043) but cross-run comparison needs it per aggregate | Handled for the aggregate view; any new metric kind must carry it too. |
| 9 | Dataset changes explaining a metric shift live in PostgreSQL versions, not linked to scores | The dashboard has to join them client-side (run → version → version diff). Works, but only because versions are immutable (ADR-031). |
| 10 | No cross-store foreign key (`DatasetRunId` in ClickHouse ↔ `dataset_runs.id`) | Consistency relies on write order (ClickHouse first, then the Postgres row). Orphans are possible after a crash between the two. |

## What the dashboard does meanwhile

The Metrics → Offline evals tab is built on the **existing** data only:

* Run-over-run charts and the run-to-run comparison use per-run aggregates (`listRuns`).
* Per-item comparison (which items regressed or improved) uses the existing run detail endpoint on both runs.
* "What changed in the dataset" uses the existing version diff (ADR-033) between the two runs' versions.
* Latency is shown **only when items carry a `TraceId`**, computed from the linked traces; otherwise the UI says it is not recorded. This is a stopgap for limitation 3, not a design.

## Target direction (not decided)

Candidate shape, to be confirmed by a follow-up ADR with a migration and SDK contract change:

* `eval_items` — one row per (run, item): input, output, expected, error, `LatencyMs`, `InputTokens`, `OutputTokens`, `CostUsd`, `TraceId`.
* `eval_scores` — one row per (run, item, evaluator), **no item text**, typed `ValueNum Nullable(Float64)` / `ValueStr`, judge identity.
* `eval_retrieved_chunks` — one row per (run, item, rank): chunk id, source, text, retrieval score, optional relevance label.
* A materialized view with per-run, per-evaluator aggregates (and latency percentiles) so run lists stop scanning scores.
* Partitioning by month and a TTL on the text columns.

Open questions: whether the SDK measures `task` latency itself or only reads it from the trace; the RAG chunk contract (a `retrieved_chunks` field on the item vs. read from retriever spans); backfill from `scores` for existing runs.

## Consequences

* Positive: the limits are explicit and linked from the roadmap; features built now know which ones depend on workarounds.
* Negative: until the follow-up ADR lands, adding many evaluators or storing large outputs scales poorly, and latency/RAG views stay approximate or absent.
