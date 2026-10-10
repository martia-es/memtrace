# ADR-077: Strict Tenant Isolation in ClickHouse

* **Status**: Accepted — implemented (2026-10-10). Row policies and a read-only query user remain open (P2 in ADR-076)
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-076](adr-076-multi-tenant-security-baseline.md)
* **Related**: [ADR-003](../storage/adr-003-clickhouse-schema-and-migrations.md), [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md)

## Context and Problem Statement

Every ClickHouse table (`otel_traces`, scores, annotations, `eval_items`, `eval_scores`, `eval_run_summaries`, `user_feedback`, …) is keyed and filtered by `ServiceName` only. In Postgres the uniqueness rule is `UNIQUE (organization_id, service_name)` (migration `001_init_identity.sql`), so two organizations can legitimately own an experiment with the same `service_name` (for example `chatbot`).

The query API injects the experiment's `service_name` into every read (`withServiceFilter`) and the repositories add `AND ServiceName = {service}`. Because that name is not globally unique:

- two clients using the same `service.name` read each other's traces, conversations, scores and annotations;
- the filter in the repository is conditional (`query.service ? " AND ServiceName = …" : ""`), so a future caller that forgets to set it returns data of **all** tenants instead of failing.

## Options Considered

| Option | Isolation | Cost | Notes |
|---|---|---|---|
| A. Make `service_name` globally unique in Postgres | Weak | Low | Forces clients to rename services; collisions leak existence of other tenants' names; the filter stays conditional |
| B. Add `ExperimentId` (UUID) column to every ClickHouse table, filter on it, make it mandatory | Strong | Medium | Identity already has it; stable if a service is renamed |
| C. One ClickHouse database per organization | Strongest | High | Migrations, pooling and cross-organization usage endpoints (ADR-023) multiply |

## Proposed Decision

**Option B**, with defense in depth.

1. Add `ExperimentId UUID` to all tenant tables through versioned migrations, as the **first** column of `ORDER BY` so it is also the cheapest filter. Backfill existing rows by mapping `ServiceName` to the experiment when it is unambiguous; ambiguous rows are reported, not guessed.
2. The repositories take an `ExperimentScope` value (non-optional) instead of an optional `service` string. A query without scope does not compile; the SQL builder always emits `ExperimentId = {experimentId:UUID}`.
3. Cross-experiment endpoints (such as ADR-023 usage) receive an explicit list of experiment ids already authorized for the user; they never run unscoped.
4. The ingestion path stamps `ExperimentId` (see [ADR-078](adr-078-ingestion-identity-binding.md)), so a client cannot choose it.
5. Add ClickHouse row policies per tenant and a read-only user for the query API as a second layer (tracked as P2 in ADR-076).

## Findings during implementation

Reading every query showed the problem was wider than the ADR first described:

1. **Detail reads were global by id.** `GET /experiments/{id}/traces/{traceId}`, `/conversations/{conversationId}`, `/transcript` and the conversation tree checked that the caller could read *an* experiment, then looked the id up across all tenants (the route comments called it acceptable because trace ids are high-entropy). Conversation ids are chosen by the client (`session("...")`), so they are guessable. Any member of any organization could read another organization's transcript by id.
2. **`GET /api/v1/services` required no session** and listed the service names of every tenant.
3. **Deduplication collisions.** In the `ReplacingMergeTree` tables the sorting key is the identity of a row. Two experiments sharing a service name and using the same trace id (a vote may target a trace that is not ingested yet) overwrote each other on merge, so one tenant could replace another's vote or annotation. `ExperimentId` therefore goes into the sorting key of those tables, not only into the filter.
4. **Optional filter.** `service?` was optional in every query type, so a caller that forgot it read all tenants. It is now a required `TenantScope`.

## Implementation

- `domain/tenant.ts`: `TenantScope { experimentId, serviceName }`, built only by `requirePermission` / `resolveApiKey`. `assertTenantScope` throws on an empty value, because `''` would match the rows from before the migration.
- Migration `013_experiment_id.sql`: `otel_traces.ExperimentId` is a `DEFAULT` column read from the resource attribute that the gateway stamps (ADR-078); the five API-written tables get the column inside the sorting key (ClickHouse only allows that for a column added in the same `ALTER` and without a `DEFAULT` expression).
- Every repository method takes the scope and emits `ServiceName = … AND ExperimentId = …` (`tenant-sql.ts`). `ServiceName` stays first so the primary key still prunes parts. Sub-queries (`hasErrors`, text, prompt filters) carry the predicate as well.
- HTTP handlers receive the scope from the route; the `service` query parameter is gone from the schemas and `withServiceFilter` was deleted.
- Cross-experiment endpoints (`/services`, `/experiments/usage`) receive the list of experiments the user can read and group by `ExperimentId`.
- Backfill (`worker/backfill-experiment-id.ts`, `make backfill-experiment-id`): assigns old rows only when the service name belongs to one experiment; ambiguous services are reported and left hidden. Tables with the id in the key are copied and the original deleted (a key column cannot be updated); the job is idempotent.
- `tests/tenant-scope-guard.test.ts` fails the build if a repository method touches the store without the tenant predicate (verified by removing one).

## Verification

Run against ClickHouse 24.3 (the cluster version) and PostgreSQL 16:

- `tests/integration/tenant-isolation.test.ts`: two experiments with the same service name, trace id, conversation id and dataset run id; 13 checks across traces, spans, conversations, aggregates, usage, scores, annotations, votes and prompt evidence. It failed before `ExperimentId` joined the sorting key.
- `tests/integration/experiment-id-backfill.test.ts`: legacy rows are invisible, are assigned when unambiguous, stay hidden when shared, and a second run changes nothing.
- The upgrade path was exercised by seeding a database at migration 012 and applying 013.
- Full suite: 790 passed. Two Postgres integration tests (`annotation-queues`, `assistant-registry`) fail identically on the branch without these changes; they are unrelated.

Originally planned checks:

- Integration test: organizations A and B each own an experiment with `service_name = "chatbot"`; data written for A is invisible through every read endpoint of B (traces, conversations, spans, metrics, scores, annotations, queues, feedback, evaluation).
- A static test fails the build if a ClickHouse query on a tenant table lacks the `ExperimentId` predicate.

## Consequences

- **Positive**: isolation no longer depends on naming; a missing filter fails loudly; renaming a service no longer orphans history.
- **Negative**: migration of every tenant table and of local data; larger sorting keys; the SDK and Collector contract (`service.name`) is unchanged but is no longer the identity of the tenant.
- **Decided**: `ServiceName` stays in the key and in the predicate; it is what lets ClickHouse prune parts.
- **Rollout**: rows written before the migration are invisible until `make backfill-experiment-id` runs. Agents keep sending traces through the gateway (ADR-078); a Collector reachable directly would write rows with no experiment, which nobody can read (ADR-079 closes that path).
