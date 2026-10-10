# ADR-037: Human Annotations — Storage in ClickHouse and Query API

* **Status**: Accepted — implemented (phase A: trace-level and span-level annotations)
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-036](../README.md#retired-adrs). Related: [ADR-028](adr-028-offline-evaluation-decoupled-sdk.md), [ADR-034](../README.md#retired-adrs), [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md).

## Context and Problem Statement

The roadmap leaves open (Phase 1.75): *"Anotación humana desde el detalle de traza (feedback manual = score con `source=HUMAN`)"*. `ScoreSource` already includes `"human"`, but the only persistence is `memtrace.scores`, whose sorting key is `(ServiceName, DatasetRunId, ItemIndex, Name)` (`migrations/clickhouse/005_scores.sql`). That table cannot hold:

1. A label on a **trace that belongs to no dataset run** (the primary use case: reviewing production traffic).
2. **Several annotators** on the same target and dimension (`ReplacingMergeTree` would collapse them into one row).
3. **Authorship** (`who`), needed for audit and for inter-annotator agreement.
4. A label on a **span** inside a trace (e.g. one tool call was wrong).
5. **Editing and retracting** a label, which `scores` never needed because evaluators only append.

Forcing these into `scores` would require changing its key and would invalidate the idempotency argument of ADR-034 (re-sending a batch is safe *because* the key is `(run, ItemIndex, Name)`).

## Decision Drivers

* Same volume/query profile as traces and scores -> ClickHouse (roadmap piece 16), keyed by `ServiceName` like every ClickHouse table.
* Annotations must be correctable (annotators misclick) and retractable, in a store without cheap `UPDATE`/`DELETE`.
* A single "what has been judged about this trace" read path should merge human annotations with automatic scores, so the UI does not need two code paths.
* Keep the rule that the API never writes trace tables; writes are confined to evaluation tables.

## Considered Options

1. **Extend `scores`** with `AnnotatorId`, `SpanId` and relax the key. Rejected: breaks ADR-034 idempotency and mixes append-only machine output with mutable human labels.
2. **New ClickHouse table `annotations`** (chosen).
3. **Annotations in PostgreSQL.** Defensible at low volume and gives FKs and real `UPDATE`, but the join with traces/scores is application-side either way, and annotation volume scales with traffic review (thousands per week for an active team), the same order as scores. Also splits the "judgments" data across two stores. Rejected; the queue *state* (low volume, transactional) does go to PostgreSQL ([ADR-039](adr-039-annotation-queues.md)).

## Decision Outcome

### Table (`migrations/clickhouse/007_annotations.sql`)

```sql
CREATE TABLE IF NOT EXISTS memtrace.annotations
(
    ServiceName    LowCardinality(String) CODEC(ZSTD(1)),
    TargetType     LowCardinality(String),           -- 'trace' | 'run_item'
    TraceId        String CODEC(ZSTD(1)),            -- '' when TargetType = 'run_item' without trace
    SpanId         String CODEC(ZSTD(1)),            -- '' = whole trace
    DatasetRunId   String CODEC(ZSTD(1)),            -- '' unless TargetType = 'run_item'
    ItemIndex      UInt32,                           -- 0 unless TargetType = 'run_item'
    ConfigId       String,                           -- score_configs.id (PostgreSQL)
    ConfigName     LowCardinality(String),           -- denormalized: the join key with scores.Name
    DataType       LowCardinality(String),           -- copied from the config at write time
    AnnotatorId    String,                           -- users.id (PostgreSQL)
    Value          String CODEC(ZSTD(1)),            -- serialized exactly like scores.Value
    Comment        Nullable(String) CODEC(ZSTD(1)),
    CreatedAt      DateTime64(3) CODEC(Delta, ZSTD(1)),   -- version column: latest write wins
    IsDeleted      UInt8 DEFAULT 0                          -- retraction tombstone
)
ENGINE = ReplacingMergeTree(CreatedAt, IsDeleted)
ORDER BY (ServiceName, TargetType, TraceId, DatasetRunId, ItemIndex, SpanId, ConfigId, AnnotatorId)
SETTINGS index_granularity = 8192;
```

Key points:

* **Why `TargetType` + sparse columns instead of one `TargetId` string**: a typed target keeps filters indexable and avoids parsing `"<runId>:<index>"`. Run items need a target because `DatasetRunItemSubmission.traceId` is nullable, so a run item with no trace can only be addressed by `(DatasetRunId, ItemIndex)`, and judge-human agreement ([ADR-040](../README.md#retired-adrs)) must cover them. Phase A exposes only `TargetType = 'trace'`; the schema reserves `run_item` so no later migration is needed.
* **Sorting key = identity of one label**: `(target, span, config, annotator)`. Re-submitting the same annotator/config/target replaces the previous row (edit). Different annotators coexist. Different configs coexist.
* **`ReplacingMergeTree(CreatedAt, IsDeleted)`** requires ClickHouse **>= 23.2**. The implementer must verify the version in `kustomization.yaml`/Helm values before relying on it; if older, fall back to `argMax` queries with an `IsDeleted` filter and no engine-level cleanup.
* **Retraction** = insert the same key with `IsDeleted = 1` and a newer `CreatedAt`. Rows are physically removed on merge; until then reads must exclude them (see below).
* **History is intentionally not preserved**: the latest value per key is the truth. If an audit trail of edits becomes a requirement, switch to an append-only table + `argMax` view (a different ADR); the sorting key above would stay the same.
* **`ConfigName` and `DataType` are denormalized** so reads and agreement computations never need PostgreSQL, and so a stored label self-describes even if the config is archived.
* **Time-to-live**: no TTL on this table. Annotations are curated, low-volume data and must outlive trace retention (see implication below).

### Read semantics

* `FINAL` is required to see deduplicated rows (same pattern as `listScoresByRun`), plus `WHERE IsDeleted = 0`. `FINAL` on this table is cheap because every query is bounded by `ServiceName` + `TraceId` or a run.
* Reads respect the query limiter already used for trace queries (`query-limiter.ts`); the ClickHouse footprint is tight in local k3d ([ADR-010](../README.md#retired-adrs)).

### Write path and client scoping

* `createScoresWriteClient` is documented as "exclusively for `scores`". It is generalized to `createEvaluationWriteClient` (rename, JSDoc updated), used by both `ClickHouseScoreRepository` and the new `ClickHouseAnnotationRepository`. Scoping stays **by repository convention** (neither repository writes to `otel_*`), as today; a dedicated ClickHouse user with `GRANT INSERT ON memtrace.scores, memtrace.annotations` is the recommended hardening and is listed as a follow-up, not a blocker.
* New port `AnnotationRepository` in `application/ports/annotation-repository.ts`; `architecture.test.ts` must keep passing (domain and application import no adapters).
* Write validation in `AnnotationService` (new file `application/annotation-service.ts`):
  1. Caller has `member` or better on the experiment (`AuthorizationService`).
  2. `configId` exists in the same experiment and is not archived (PostgreSQL read).
  3. `value` validates against the config (`numeric` in `[min,max]`; `boolean` in `{"true","false"}`; `categorical` in config labels). Reject with `422`.
  4. The **target exists in this tenant**: for `trace`, `TraceRepository` must find the trace under the experiment's `ServiceName`. Without this check a user could write annotations pointing at another tenant's `TraceId`. A trace still being ingested returns `404`; the UI only offers annotation from an existing detail page, so this is rare.
  5. `AnnotatorId` is **always** the authenticated user's id; the body cannot set it.

### API

```
POST   /api/v1/experiments/:experimentId/traces/:traceId/annotations
       body: { configId, value, comment?, spanId? }      -> upsert for (caller, trace, span, config)
GET    /api/v1/experiments/:experimentId/traces/:traceId/annotations
       -> { annotations: [{ configId, configName, dataType, value, comment, spanId, annotator: {id, name}, createdAt }],
            scores: [...] }                              -- human + automatic scores of the same trace, see below
DELETE /api/v1/experiments/:experimentId/traces/:traceId/annotations/:configId?spanId=
       -> retracts the CALLER's own annotation (tombstone). 204
```

* **Only the author can edit or retract their annotation.** An `admin` can retract anyone's (moderation) through the same DELETE with an `annotatorId` query parameter; this is an audited tombstone row, not a silent overwrite.
* **Annotator names**: ClickHouse stores only the id. The service resolves display names from PostgreSQL in one batched lookup (`IdentityRepository`), never joining across stores in SQL. A removed member's annotations remain and show "former member".
* **Unified read** (`scores` in the response): for a trace linked from dataset run items (`scores.TraceId`), the endpoint includes automatic scores tagged with their `source` (`code`/`llm_judge`), so the trace page shows machine and human judgments together. The `scores` table has no index on `TraceId` (its key leads with `DatasetRunId`); the lookup is a bounded scan filtered by `ServiceName` and `TraceId`. **If this proves slow**, add a skipping index (`INDEX idx_trace TraceId TYPE bloom_filter`) in a follow-up migration rather than reshaping the table.
* Idempotency: POST is naturally idempotent for the same body (same key, newer `CreatedAt`).
* Concurrency: two tabs of the same user race "last write wins" by `CreatedAt`; acceptable for single-author labels. `CreatedAt` is set by the API (server clock), never trusted from the client.

### Domain model

`Score` stays as is. A new `Annotation` type (`api/src/domain/annotation.ts`) is separate; `ScoreSource` gains no new value (`"human"` remains the label under which annotations are *presented* in unified reads). Keeping the types separate avoids the temptation to give machine scores an `annotatorId` and a `spanId` they do not have.

## Design Implications

* **Retention vs. traces.** If trace retention (TTL on `otel_traces`) is ever enabled, annotations become orphaned. This is deliberate: a label is valuable on its own and the unified read must tolerate a missing trace. Anything that *needs* the trace content later (promotion to a dataset, [ADR-038](../datasets/adr-031-dataset-versioning.md)) must **copy** it at promotion time, never reference it.
* **Content redaction ([ADR-021](../sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md)).** If an SDK redacts prompts, annotators see redacted content and their labels reflect that. Nothing here decrypts or restores content.
* **Privacy of `Comment`.** Free-text comments may contain sensitive data pasted from a trace. They share the tenant boundary of the trace and are never returned outside the experiment. No cross-experiment endpoint (cf. [ADR-023](../README.md#retired-adrs)) may expose them.
* **Cost of `FINAL` and per-trace reads** is bounded; **list-level aggregates** ("percent of traces annotated as incorrect over the last 7 days") need a separate aggregate query on `annotations` with `FINAL`. That is Phase D territory and is not exposed in A.
* **Multi-annotator display**: A shows all annotations; no consensus/adjudication is defined. "Which label wins when annotators disagree" is deliberately deferred to [ADR-040](../README.md#retired-adrs) (reporting) rather than baked into storage.

## Consequences

* **Positive**: production traces can be labeled without a dataset; multiple annotators and span-level labels work out of the box; edits and retractions are supported; agreement analysis has a clean source of truth.
* **Negative**: a second ClickHouse write path and one more table to keep consistent with PostgreSQL ids (no FK). Dual-store consistency is limited to config existence at write time (validated) and user existence for display (resolved on read).
* **Negative**: no edit history. Accepted; see "History".
* **Negative**: `ReplacingMergeTree` dedup is eventual until merge; every read uses `FINAL`. Same trade-off as `scores`.

## Open Questions

* Allow annotating **conversations** (the grouping used in `ConversationDetailPage`)? Probably as a thin wrapper over the root trace, deferred.
* Do we need a `Source` column to later admit machine "annotations" on the same table (e.g. imported labels from another tool)? Not now; import tooling would target `scores` or a dedicated importer ADR.

## Implementation Checklist

- [x] `migrations/clickhouse/007_annotations.sql`, registered in `kustomization.yaml`; verified against ClickHouse **23.8** (the version in `k8s/20-clickhouse.yaml`)
- [x] `domain/annotation.ts` (`validateAnnotationValue` + tests)
- [x] Port + `ClickHouseAnnotationRepository`; write client renamed to `createEvaluationWriteClient`; integration test `api/tests/integration/annotations.test.ts`
- [x] `AnnotationService` with unit tests (value validation, tenant check, span check, edit, tombstone, moderation)
- [x] Routes + zod schemas + contract + mappers; errors mapped in `identity-guard.ts`
- [x] Dashboard: `TraceAnnotationsPanel.vue` opened from the **Annotate** button in `TraceDetailPage.vue`; client in `application/trace-api.ts`; fakes and tests
- [x] `docs-site/platform/api.md`, `docs-site/library/evaluation.md`, roadmap

## Implementation Notes

* **Verified, not assumed.** On ClickHouse 23.8 the migration applies, an edit by the same annotator replaces the previous row, annotators/configs/spans coexist, and a tombstone is excluded from `FINAL` reads (the explicit `IsDeleted = 0` is kept as a guard for other versions). No fallback to `argMax` was needed.
* **Reads and the query limiter.** `ClickHouseAnnotationRepository` has its own `QueryLimiter` sized with the same `CLICKHOUSE_MAX_CONCURRENT_QUERIES`; it does not share a budget with the trace repository, so total concurrency can reach the sum of both.
* **Moderation audit.** A tombstone keeps the original row's key, so who retracted it would be lost on merge. When an admin retracts someone else's label, the tombstone's `Comment` records `Retracted by admin <userId>`. No schema change.
* **Annotator names.** The API returns the user's `name` only, never the email (members cannot list other members, ADR-016). `null` (no name, or user removed) is shown as "Former member".
* **POST returns the full view** (`annotations` + `scores`, `201`) instead of just the saved row, so the client refreshes from one response.
* **Config ids that are not UUIDs** resolve to "not found" in the PostgreSQL adapter (404) instead of failing the `uuid` cast (500). This also applies to the ADR-036 endpoints.
* **Tenant check scope.** The trace must have at least one span under the experiment's `ServiceName` (the first 5000 spans are examined, like the trace detail). A `spanId` is rejected unless the trace was truncated, in which case it is accepted unchecked.
* **Not done:** conversation-level annotation (open question). Delivered later: inline "create score config" in the annotation panel (admins), `run_item` targets (through annotation queues, ADR-039) and the dedicated ClickHouse user with `GRANT INSERT` ([ADR-045](../README.md#retired-adrs)).
