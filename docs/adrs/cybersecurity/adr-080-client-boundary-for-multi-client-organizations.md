# ADR-080: Client Boundary for Multi-Client Organizations

* **Status**: Pending — decision required from the product owner
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-076](adr-076-multi-tenant-security-baseline.md)
* **Related**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)

## Context and Problem Statement

The model is `Organization → Experiment`, and `org_admin` has implicit access to **every** experiment of its organization (ADR-013, ADR-052). That is right for a company grouping its own agents. It is wrong for a consultancy that manages many clients:

- if the consultancy puts all its clients in one organization, every `org_admin` sees every client's traces, datasets and prompts;
- if each client gets its own organization, the consultancy has no way to operate them as one business (shared staff, shared billing, one login, cross-client overview), and each staff member must be invited N times;
- identity settings (SCIM, group mappings, theme, environments) belong to the organization, so they cannot be shared across clients either.

The isolation boundary must be the **client**, and the consultancy must still be able to staff clients selectively.

## Options Considered

| Option | Client isolation | Consultancy operations | Cost |
|---|---|---|---|
| A. One organization per client, plus a **partner** relationship: a consultancy organization is granted a scoped role (for example `partner_admin`) on client organizations | Strong: the client organization is the boundary and the client controls the grant | Good: consultancy staff see the list of client organizations they are granted; no data is shared | Medium: new `organization_partnership` table, permissions evaluated across two organizations |
| B. New level **Workspace/Client** between organization and experiment; `org_admin` manages the structure, access to a client's experiments needs a workspace role | Medium: boundary is inside one organization, so a mistake in role assignment crosses clients; identity and billing shared | Best: one login, one SCIM, one theme | High: new level in every permission check and in the UI |
| C. Keep the model; add per-experiment **deny** for `org_admin` | Weak: opt-out instead of opt-in; default remains "sees everything" | Poor | Low, but unsafe by default |

## Proposed Direction

**Option A** is the recommended starting point: it keeps the organization as the hard isolation boundary already used everywhere (queries, API keys, SCIM, themes), lets the *client* own and revoke the consultancy's access, and does not change the meaning of `org_admin`. Option B is kept as the alternative if the product prefers a single tenant with internal client folders.

Principles that hold under either option:

1. Access to client data is **opt-in per client**, never inherited by being staff of the consultancy.
2. `org_admin` of a client organization controls who from the partner can enter and with which role; revoking is immediate.
3. Cross-client views (usage, billing, health) show aggregates and metadata only, never trace content, unless the viewer holds an explicit role in that client.
4. Every partner access is written to the audit log (P1 in ADR-076).
5. Permission resolution stays in `AuthorizationService` (ADR-052); no route compares roles by name.

## Open Questions (blocking acceptance)

- Does the client or the consultancy own the data when the contract ends (export and deletion, see erasure in ADR-076)?
- Should the consultancy see a unified list of clients in the dashboard (needs a partner-level home screen)?
- Are partner roles limited to existing experiment roles (`technical`, `business`) or is a new support role with read-only access needed?
- One login identity can belong to several partner and client organizations; how is the active context chosen and shown in the UI?

## Verification (once accepted)

- A consultancy user granted on client X cannot read, list or learn the existence of client Y's experiments.
- Revoking the grant removes access to API, dashboard and cached sessions within one request.
- The authorization tests of ADR-052 are extended with the cross-organization cases above.

## Consequences

- **Positive**: the consultancy scenario becomes a first-class, safe-by-default use case; the client keeps control of its data.
- **Negative**: new data model and permission paths, new UI for partners, and a decision that affects billing, support and data ownership beyond engineering.
