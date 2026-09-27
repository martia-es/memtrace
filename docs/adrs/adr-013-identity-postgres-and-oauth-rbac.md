# ADR-013: PostgreSQL Identity Store with Federated OAuth Login and Two-Level RBAC

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Phase 1 shipped without any access control: anyone with network access to the dashboard, the query API, or the OTel Collector can read every trace or write fake ones. Before starting Phase 2 (Mem), the roadmap requires closing this gap (Phase 1.5): human login via Google and Microsoft, and authorization so that not everyone can see everything.

This requires deciding where identity data lives, and how authorization is modeled and enforced.

## Decision Outcome

### 1. A second, independent data store

Users, organizations, experiments and memberships are transactional data (few rows, point writes, referential integrity between users/orgs/experiments) — the opposite access pattern of trace data (huge volume, append-only, aggregate reads). Reusing ClickHouse (an OLAP store) for this would force it into an OLTP role it is not designed for.

**PostgreSQL** is added as a second store, used only by piece 4 (query API), behind its own repository interface — the same pattern ADR-003/ADR-009 already use for ClickHouse access. Piece 4 remains the only piece that knows either store exists; piece 5 (dashboard) still only talks HTTP/JSON to piece 4.

### 2. Domain model: Organization → Experiment

- An **Organization** groups any number of **Experiments**.
- An **Experiment** is the trace + dashboard view of one instrumented agent (what other observability platforms call a "project" or "experiment"). Each experiment belongs to exactly one organization.
- This is multi-tenant by construction: an organization is the isolation boundary a company would expect, without adding a separate concept later.

### 3. Two-level RBAC, 3 roles total

- `org_admin` (organization level): implicit admin over **every** experiment in the organization, without needing an explicit membership row per experiment. Can create experiments in the organization and invite users (as `org_admin`, or directly into a specific experiment).
- `admin` (experiment level): read access to that experiment, plus inviting other users into that same experiment as `admin` or `member`.
- `member` (experiment level): read-only access to that experiment.

There is no global/superuser role. Authorization for "can user U act on experiment E" is:

```
org_admin(U, E.organization_id) OR membership(U, E.id) is not null
```

### 4. Bootstrap

Any authenticated user can create an organization and becomes its first `org_admin`. Creating an experiment requires being `org_admin` of the target organization (not "any authenticated user", since experiments now live inside an organization's boundary).

### 5. Authentication: OIDC via Auth.js, agents via API key

- Human login is federated: Google and Microsoft (Entra ID) as OIDC providers, implemented with **Auth.js** inside the existing Next.js query API (piece 4). No passwords are stored by MemTrace.
- Agent-to-Collector authentication (who is allowed to write traces) is a separate, simpler mechanism — a static API key per agent, validated at the OTel Collector — and is not part of this ADR's data model.

### 6. Secrets

OAuth client IDs/secrets live in `.env` for local development, consistent with the rest of local configuration. This is revisited when a Cloud deployment is planned (a real secret manager is out of scope for local kind).

## Consequences

- **Positive**: clear isolation boundary per organization; simple 3-role model with no per-resource permission matrix to design/maintain; existing ClickHouse access pattern untouched; identity fully decoupled behind its own repository interface.
- **Negative**:
  - A second stateful service (PostgreSQL) to run and back up in `k8s/`, on top of ClickHouse.
  - Every existing query API endpoint must be retrofitted with an authorization check; until that is done, those endpoints remain unauthenticated.
  - No per-resource (e.g. per-conversation) permission granularity — deliberately deferred; would require a new ADR if ever needed.
  - `.env`-based secrets are a known local-only shortcut; must be revisited before any Cloud deployment.
