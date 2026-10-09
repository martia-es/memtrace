# ADR-077: Strict Tenant Isolation in ClickHouse

* **Status**: Pending
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

## Verification

- Integration test: organizations A and B each own an experiment with `service_name = "chatbot"`; data written for A is invisible through every read endpoint of B (traces, conversations, spans, metrics, scores, annotations, queues, feedback, evaluation).
- A static test fails the build if a ClickHouse query on a tenant table lacks the `ExperimentId` predicate.

## Consequences

- **Positive**: isolation no longer depends on naming; a missing filter fails loudly; renaming a service no longer orphans history.
- **Negative**: migration of every tenant table and of local data; larger sorting keys; the SDK and Collector contract (`service.name`) is unchanged but is no longer the identity of the tenant.
- **Open question**: whether to keep `ServiceName` in the key for compatibility with existing queries or drop it after the migration.
