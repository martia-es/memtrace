# ADR-044: Split Offline Evaluation Storage into `eval_items` and `eval_scores`; Read Latency, Tokens and Cost from the Linked Trace

* **Status**: Accepted
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Resolves**: limitations 1, 2, 3, 4, 5 and 10 of [ADR-042](adr-042-offline-evaluation-storage-model-limitations.md)
* **Relates to**: [ADR-028](adr-028-offline-evaluation-decoupled-sdk.md), [ADR-034](adr-034-run-records-dataset-version-and-uploads-incrementally.md), [ADR-037](adr-037-human-annotations-storage-and-api.md), [ADR-043](adr-043-record-judge-identity-on-scores.md), [ADR-025](../pricing/adr-025-model-pricing-catalog-sync.md)

## Context

ADR-042 documented why the single `memtrace.scores` table (one row per run × item × evaluator, item text repeated on every row, `Value` as a `String`) does not scale to the planned features. This ADR decides the replacement. Constraints that shaped it:

* The data in the development database is disposable: no backfill or dual-write is needed, we start from zero.
* Latency, tokens and cost must come **from traces only**; the SDK does not time `task`.
* Retrieved RAG chunks must come **from spans**, not from a table of their own.
* The dashboard only talks to the query API, which hides the storage (roadmap, piece 4), so the HTTP contract can stay stable.

Investigating the SDK for this ADR also found a defect that the trace-based design depends on: `run_experiment` filled `trace_id` with `get_current_run_id()` *after* `task` returned (always `None`, the context variable is already reset) and, even when set, it was MemTrace's internal span UUID, not the OpenTelemetry trace id. In practice no item ever carried a usable `TraceId`.

## Decision

### 1. Two tables with the right cardinality (`migrations/clickhouse/008_eval_items_and_scores.sql`)

| Table | Grain | Key | Content |
|---|---|---|---|
| `eval_items` | (run, item) | `(ServiceName, DatasetRunId, ItemIndex)` | `Input`, `Output`, `ExpectedOutput`, `Error`, `TraceId` (bloom-filter index) |
| `eval_scores` | (run, item, evaluator) | `(ServiceName, DatasetRunId, ItemIndex, Name)` | `Value` (as sent), `ValueNum Nullable(Float64)`, `DataType`, `Source`, `Comment`, `JudgeModel`, `JudgePromptHash` — **no item text** |

Both are `ReplacingMergeTree(CreatedAt)`, so resending a batch stays idempotent (ADR-034).

* The item text is stored once, however many evaluators run (limitation 1).
* `ValueNum` is the typed column: the number for `numeric`, `1`/`0` for `boolean`, `NULL` for `categorical`. Aggregates use `avgIf(ValueNum, …)` instead of `toFloat64OrNull(Value)` (limitation 2). `Value` keeps the original string so annotations, agreement (ADR-040) and the API contract are unchanged.
* An item without scores (`task` failed) is just an `eval_items` row. The `_no_score` placeholder row is gone (limitation 5).
* Because item and scores are now separate, the old `scores` table is **dropped** by the same migration, and the run-item annotations/queue items that pointed at it are deleted (`postgres/016_reset_dataset_runs.sql` removes the old `dataset_runs`). Both run once (`schema_migrations`). Dataset versions and trace annotations are untouched.

### 2. Latency, tokens and cost are read, not stored (limitation 3)

Traces arrive asynchronously through OTLP, so they may not exist yet when the SDK uploads an item. Storing derived numbers at upload time would freeze wrong values. Instead:

* `eval_items` stores only `TraceId`.
* `TraceRepository.getTraceStatsForTraces(traceIds)` does one query over `otel_traces` (bounded by the traces' time window from `otel_traces_trace_id_ts`): root-span duration and, for `gen_ai.operation.name = chat` spans, input/output tokens grouped by model.
* `TraceQueryService.getItemTelemetry` prices them with the pricing catalog (ADR-025). Cost sums only models with a known price and is `null` if none has one.
* The run-detail endpoint adds `telemetry: { latencyMs, inputTokens, outputTokens, costUsd } | null` to each item. `null` means no trace, or the trace is missing/expired. If the trace store fails, the detail is served without telemetry.
* The dashboard no longer fetches one trace per item (it was capped at 100): it summarises `item.telemetry` (p50/p95/max, tokens, cost) in the Run and Compare views.

Trade-off accepted: telemetry disappears when the trace is deleted by its 30-day TTL. If long-lived history is needed, a snapshot at run completion can be added later without changing the contract.

### 3. The SDK links every item to a real trace

`run_experiment` takes an optional `item_scope` (a context manager that yields a trace id), so the runner stays backend-agnostic. The `memtrace.eval.run_experiment` facade supplies one that opens an `eval.item` root span per item and yields its **OpenTelemetry trace id** (`SpanHandle.trace_id`, 32 hex chars, the id the dashboard and API use). It is only active if `init_tracer()` already ran; nothing is initialised as a side effect, and without a tracer `trace_id` stays `None`. The id is recorded even when `task` raises. Evaluators run outside that span, so judge LLM calls do not inflate the item's latency or tokens.

### 4. Retrieved chunks come from retriever spans (limitation 4)

No table. A retriever span (`memtrace.step_type = retriever`) carries:

* `memtrace.retriever.documents`: number of chunks (already existed).
* `memtrace.retriever.chunks`: JSON array, in rank order, of `{ "text", "id"?, "source"?, "score"? }`. It is content, so it is exported only when content capture is enabled and is truncated by the capture policy.

The LangChain callback fills it automatically; for manual instrumentation `memtrace.record_retrieved_chunks(documents)` annotates the current span. Chunks are visible today in the span inspector of the item's trace. **Not decided here**: retrieval metrics (recall@k, MRR) — they need relevance labels (expected chunks) that datasets do not have yet.

### 5. Same port, same HTTP contract

`ScoreRepository` keeps its name and methods (`insertScores`, `listScoresByRun`, `listScoresByTrace`, `listJudgeScoresForRuns`, `aggregateForRuns`); only `ClickHouseScoreRepository` changed. `listScoresByTrace` now joins `eval_scores` to `eval_items` by `TraceId`. Annotations, queues, agreement and aggregates behave as before. The only contract addition is the optional `telemetry` field on run-detail items.

## Alternatives considered

* **Dual-write / backfill / coexistence of old runs**: unnecessary, there is no data worth keeping and it would leave two read paths for good.
* **`LatencyMs`/`CostUsd` columns on `eval_items`, filled by the SDK**: requires the SDK to time `task` (rejected) or the trace to exist at upload time (it may not).
* **`eval_retrieved_chunks` table**: duplicates what spans already hold and would need a second capture contract.
* **Materialised per-run aggregates, monthly partitioning and TTL on text columns**: deferred. There is no volume evidence yet; revisit when run lists or text storage show real cost.

## Consequences

* Positive: item text is stored once; numeric analytics use a typed column; latency, tokens and cost work with no extra SDK contract and no per-item trace fetches; the trace id is now actually captured.
* Negative: the first deployment wipes previous evaluation runs and their run-item labels; telemetry requires the user to call `init_tracer()` and depends on trace retention; a run-detail read now issues two queries on the evaluation tables plus one on traces.
* Still open: nothing from this list. Partitioning/TTL, stored run summaries and retrieval metrics were delivered in [ADR-045](adr-045-evaluation-follow-ups-retrieval-metrics-summaries-retention-and-writer-user.md).
