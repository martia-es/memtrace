# ADR-099: Deduplicated Span Storage with ReplacingMergeTree

* **Status**: Accepted — not implemented yet. Runs after the broker of ADR-098 is in place (phase 5 of its rollout)
* **Date**: 2026-10-17
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-003](adr-003-clickhouse-schema-and-migrations.md), [ADR-084](adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-088](../cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md), [ADR-098](../infra/adr-098-durable-ingestion-pipeline-with-broker.md)

## Context and Problem Statement

[ADR-098](../infra/adr-098-durable-ingestion-pipeline-with-broker.md) makes the pipeline resilient by retrying and by reading again from a broker after a failure. That is **at-least-once** delivery: the same span can reach ClickHouse more than once (an SDK retry after a timeout, a gateway or Collector retry, a consumer that restarts before committing its offset). `memtrace.otel_traces` is a plain `MergeTree`, so every copy is stored and counted twice by every aggregation (spans, errors, tokens, cost).

Two facts about the current table shape the solution:

- **Its sort key has no span identity**: `ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))` (ADR-003). Used as-is by a `ReplacingMergeTree`, it would treat two *different* spans of one service with the same name in the same second as "the same row" and delete one of them. That is worse than a duplicate: it loses real data.
- **`TraceId` and `SpanId` are chosen by the client.** If the identity of a span were only `(TraceId, SpanId)`, a tenant could overwrite another tenant's span by sending the same ids. This is the same collision ADR-088 closed for the write-side tables (migration 014 puts `ExperimentId` in their `ORDER BY` for that reason, and the project already reads them with `FINAL`, for example in the annotation repository).

## Decision Outcome

### 1. Identity of a span

`(ServiceName, ExperimentId, TraceId, SpanId)`. The tenant is part of the identity, so no tenant can replace another's rows, and two distinct spans never collapse. Identical copies of one span also share `SpanName` and `Timestamp`, so including them in the sort key does not stop real duplicates from matching.

### 2. New table: `ReplacingMergeTree` with the identity in the sort key

```sql
CREATE TABLE memtrace.otel_traces_v2 ( /* same columns as otel_traces */ )
ENGINE = ReplacingMergeTree
PARTITION BY toDate(Timestamp)
PRIMARY KEY (ServiceName, ExperimentId, SpanName, toDateTime(Timestamp))
ORDER BY    (ServiceName, ExperimentId, SpanName, toDateTime(Timestamp), TraceId, SpanId)
TTL toDateTime(Timestamp) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

- `ReplacingMergeTree` removes rows with an equal **whole sort key** during merges; `PRIMARY KEY` is the prefix, so the sparse index and every existing query that filters by service, experiment and time keep working as before. `ExperimentId` moves to the front because ADR-088 already requires it in every query; it was only a bloom-filter index before.
- Deduplication happens **within a partition**. Copies of one span have the same `Timestamp`, hence the same day, so they always land in the same partition.
- The exact DDL (that `ExperimentId` may keep its `DEFAULT ResourceAttributes['memtrace.experiment_id']` while being part of the key, and the codecs) is confirmed on a real ClickHouse in the migration branch; this section fixes the identity, the engine and the key, not every clause.
- The auxiliary `otel_traces_trace_id_ts` and its materialized view are re-pointed to the new table. They store `min`/`max` per trace, so duplicates do not change their meaning; they only add rows, and that table is a lookup, not a source for counts.

### 3. Reads: deduplication is eventual, so the API must account for it

Merges happen in the background. Until a merge, both copies are visible. Rule for the query layer (`api/src/adapters/outbound/clickhouse/`, 15 references in 7 files today: trace, breakdown and prompt-evidence repositories, data exporter, purger, backfill, client):

- Any query that **counts or aggregates spans** (error rate, tokens, cost, latency percentiles, breakdowns, alert evaluation) reads with `FINAL`, or from a subquery that keeps one row per identity.
- Lookups by id of a single trace show a span twice until a merge: each of them is reviewed (and de-duplicated by `SpanId` where it builds a tree), not assumed to be safe.
- `FINAL` has a cost. It is measured with the load gate before and after, and `do_not_merge_across_partitions_select_final` is evaluated as an optimisation because the partition key guarantees that equal keys live in one partition. Thresholds in `load-testing/thresholds.json` are revisited with the numbers.
- Deletes keep working: `ALTER TABLE … DELETE` mutations (retention purge, ADR-084) apply to this engine too, and the 365-day TTL ceiling of migration 013 is carried over.

### 4. Migration without losing data

ClickHouse cannot change the sort key of an existing table in place (migration 014 could only append columns added in the same `ALTER`), so the change is a table swap, done after the broker exists:

1. Create `otel_traces_v2` and its view (new migration, idempotent, privileges for the `collector` and `api_writer` users updated in the migration Job).
2. Copy history with `INSERT … SELECT`, one day-partition at a time, to keep memory bounded. The target dedupes as it merges.
3. **Pause the consumer Collectors** (the broker holds the incoming data), copy the delta since step 2, and `EXCHANGE TABLES memtrace.otel_traces AND memtrace.otel_traces_v2` (atomic in an `Atomic` database). The exporter keeps writing to the name `otel_traces`; the API needs no change of table name.
4. Resume the consumers; the lag accumulated during the pause drains.
5. Keep the old table (now `otel_traces_v2`) for a grace period (default 14 days) for rollback, then drop it. Backups (ADR-096) and `make restore-test` include the new table.

Without a broker the pause in step 3 would lose or reject traces, which is why this ADR is sequenced after ADR-098.

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Block-level insert deduplication (`non_replicated_deduplication_window`, insert tokens) | Only recognises a re-sent **identical block**. A consumer that replays after a restart can build different batches, so duplicates would pass |
| Deduplicate only on read (`DISTINCT`, `LIMIT 1 BY`, `argMax`) | Leaves duplicates stored forever, makes every query pay for it and depends on nobody forgetting it |
| Identity `(TraceId, SpanId)` only | Lets a tenant overwrite another tenant's span by choosing the same ids (ADR-088) |
| Keep the current sort key, `ReplacingMergeTree` on top | Merges distinct spans (same service, name and second); loses data |
| Exactly-once with Kafka transactions | Applies inside Kafka; the write to ClickHouse still needs an idempotent destination |
| `AggregatingMergeTree` with state per span | Powerful but heavy for rows that are complete spans; unnecessary here |

## Consequences

- **Positive**: counts and costs stay correct under retries and consumer replays; the tenant is part of the identity; the table keeps its query path (same prefix as before); the swap is lossless thanks to the broker.
- **Negative**:
  - Deduplication is **eventual**; every aggregating query needs `FINAL` (or an equivalent) and pays for it.
  - A one-off migration that copies all history; disk use roughly doubles until the old table is dropped.
  - Rows are physically a little wider in the sort key (two more columns), and `ExperimentId` in the front of the key changes data locality: confirm the effect on compression and query time with the load gate.
  - Rows written before migration 014 have an empty `ExperimentId` and keep failing closed, as today; the backfill must have completed before the copy.

## Verification

- Test: insert the same span twice (and a batch replayed twice); after `OPTIMIZE … FINAL` one row remains, and queries with `FINAL` return one row before the merge.
- Test: two spans with the same service, name and second but different `SpanId` both survive.
- Test: two experiments that send the same `TraceId` and `SpanId` both survive (tenant collision).
- Test: the retention purge deletes from the new table; `make restore-test` restores it.
- Performance: the load gate query p95 before and after the swap, against provisional thresholds.
- Migration rehearsal on a copy with real volume, including the pause and exchange, before running it on a shared environment.
