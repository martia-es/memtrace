# ADR-045: Evaluation Follow-ups: Retrieval Metrics, Stored Run Summaries, Retention, and a Write-only ClickHouse User

* **Status**: Accepted
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Closes**: the "still open" items of [ADR-044](adr-044-eval-items-and-scores-tables-telemetry-from-traces.md) (partitioning/TTL, materialised aggregates, retrieval metrics), the ClickHouse-user follow-up of [ADR-037](adr-037-human-annotations-storage-and-api.md), the resolved-model deferral of [ADR-043](adr-043-record-judge-identity-on-scores.md) and the batch promotion deferral of [ADR-038](../datasets/adr-038-promote-trace-to-dataset-item.md).

## Decisions

### 1. Retrieval metrics are SDK evaluators fed from an in-process capture

`RecallAtK(k)`, `MRR()` and `HitRate()` in `memtrace.eval`. They are ordinary `Evaluator`s that return numeric/boolean scores (`recall_at_5`, `mrr`, `hit_rate`), so storage, charts, run comparison and the judge-warning logic work with **no server or dashboard change**.

* **Labels** live in the dataset item: `metadata["relevant_docs"]` is a list of ids/sources (configurable with `relevant_key=`). A chunk is relevant when its `id` or `source` is in the list. An item without labels yields **no score** (not a zero), so labelled and unlabelled items can share a dataset.
* **Chunks** reach the evaluator through `retrieval_scope()` (a `ContextVar` opened by the runner around each `task`). Both ways of reporting chunks (`record_retrieved_chunks` and the LangChain callback) also `note_retrieved(chunks)`. The runner passes them as the `retrieved_chunks` keyword; evaluators that do not declare it never see it (`_call_evaluator` filters). The capture does not depend on content capture: it is in memory and the span attribute stays opt-in.
* Rejected: computing the metrics in the API from the trace's retriever spans. It needs the item's labels on the server (`eval_items` has no metadata) and traces expire after 30 days; the SDK already has both labels and chunks at hand.

### 2. Run summaries are written once, when the run completes

New table `eval_run_summaries` (one row per run × evaluator: count, average/pass rate, distinct judges). `EvaluationService` stores it when a batch arrives with `complete`; `aggregateForRuns` reads summaries for the runs that have one and computes the rest live from `eval_scores`. A failed summary write is logged and costs nothing: reads fall back to the live path.

* **Not a `MATERIALIZED VIEW`**: batches are resent idempotently (ADR-034) and `eval_scores` deduplicates them as a `ReplacingMergeTree`; an incremental aggregate would count the resend twice.
* A completed run is closed (`DatasetRunClosedError`), so its summary is exact and never needs invalidation.
* Runs completed before this ADR have no summary and keep being computed live.

### 3. Monthly partitions and a 180-day TTL on item text

Migration `009` rebuilds `eval_items` and `eval_scores` with `PARTITION BY toYYYYMM(CreatedAt)` (ClickHouse cannot add a partition key with `ALTER`: create, copy, `EXCHANGE TABLES`, drop). `eval_items` gets a **column** TTL of 180 days on `Input`, `Output`, `ExpectedOutput` and `Error` only. When it expires those columns return to their default (empty / `NULL`); scores, trends and summaries stay. Run detail of old runs therefore shows items without text. The window is changed with `ALTER TABLE … MODIFY COLUMN … TTL`.

### 4. A write-only ClickHouse user for the API

The API's evaluation write client uses `CLICKHOUSE_WRITE_USER` / `CLICKHOUSE_WRITE_PASSWORD` (falling back to the read credentials when unset, so local development is unchanged). In k8s the migration job creates `api_writer` with `INSERT` on `eval_items`, `eval_scores`, `eval_run_summaries` and `annotations` only: no `SELECT`, no access to `otel_*`. Because of that, the summary is read with the read client and inserted with the write client. Creating users needs `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` on the server. The job re-applies `CREATE USER` + `ALTER USER` on each run, so rotating the secret works. Other components (collector, pricing sync, topic extraction) still use `default`.

### 5. The judge records the model the provider actually served

`LLMReply` is a `str` subclass with a `.model` attribute. A client may return it from `complete`; any client returning a plain `str` keeps working. `AnthropicJudgeClient` returns `response.model`. The judge stores that id when present, else the requested/default one. A floating alias that is silently repointed now changes `judge_model` and trips the existing "judge changed" warning (ADR-043).

### 6. Dashboard: batch promotion and inline score configs

* **Queue detail → Promote to dataset**: sends the queue's completed *trace* items to a chosen dataset, in batches of 100 (the server limit); each batch is one new major version. Optionally takes the expected output from a categorical rubric label (`fromConfigId`). Skipped traces (already promoted, no content, annotators disagree…) are summarised in the notice. No new endpoint.
* **Annotate panel → New score config** for experiment admins, reusing the Admin form (`NewScoreConfigModal`).
* ADR-037's "`run_item` targets" was already delivered by annotation queues (ADR-039); it is no longer pending.

### 7. Claim race in annotation queues (found while running the ADR-038 integration test)

`claimNext` could hand one item to more reviewers than `required_annotations` when two claims interleaved: `FOR UPDATE SKIP LOCKED` locks the item row, but the claim count lives in another table and is not re-evaluated after the other transaction commits. Each claim now takes `pg_advisory_xact_lock` per queue. Claims are millisecond transactions, so serialising them per queue is acceptable.

## Consequences

* Positive: RAG quality can be tracked per run with the existing charts; trend/list pages stop re-aggregating completed runs; a compromised or buggy API write path can no longer touch traces; old text is bounded.
* Negative: summaries and the 180-day TTL are an extra moving part; migration 009 can lose rows uploaded between its copy and its exchange (documented in the file); recall@k needs hand-made labels; `api_writer` requires `access_management` on the ClickHouse server.
* Not done: materialising aggregates for runs that completed before this ADR; per-experiment retention settings.
