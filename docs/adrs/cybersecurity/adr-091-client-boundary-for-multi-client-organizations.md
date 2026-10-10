# ADR-091: Client Boundary for Multi-Client Organizations

* **Status**: Accepted — option A, backend implemented (2026-10-10). The dashboard screens for it are still to do
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team (option chosen by the product owner on 2026-10-10)
* **Parent**: [ADR-087](adr-087-multi-tenant-security-baseline.md)
* **Related**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md), [ADR-088](adr-088-strict-tenant-isolation-in-clickhouse.md)

## Context and Problem Statement

The model is `Organization → Experiment`, and `org_admin` has implicit access to **every** experiment of its organization. That is right for a company grouping its own agents. It is wrong for a consultancy that manages many clients:

- if all clients live in one organization, every `org_admin` sees every client's traces, datasets and prompts;
- if each client gets its own organization, the consultancy has no way to operate them as one business, and each staff member must be invited once per client.

The isolation boundary must be the **client**, and the consultancy must still be able to staff clients selectively.

## Decision Outcome

**Option A: one organization per client, plus a partner relationship.** The client organization stays the hard isolation boundary already used by queries (ADR-088), API keys, SCIM and themes. A consultancy is just another organization, the *partner*; the client decides what its people can do.

| Option considered | Why not |
|---|---|
| B. A client level inside one organization | The boundary would sit inside one tenant, so a role mistake crosses clients; touches every permission check and screen |
| C. Per-experiment deny for `org_admin` | Opt-out instead of opt-in: the default would still be "sees everything" |

### Model (migration `043_partnerships.sql`)

- `organization_partnerships(client, partner, created_by, revoked_at…)`: created by an `org_admin` **of the client**, naming the partner by the id of its organization. One active relationship per pair. By itself it grants nothing.
- `partner_grants(partnership, user, role, experiment_id | NULL, granted_by, revoked_at…)`: the client picks a *person* (by email, who must be a member of the partner organization), an **experiment role** (`technical`, `business`, any role with experiment scope) and a scope: the whole client organization (NULL, including experiments created later) or one experiment.
- Nothing is deleted on revocation (`revoked_at`, `revoked_by`), so who had access and when can be reconstructed.

### Rules

1. **Opt-in per client.** Being staff of the consultancy gives access to nothing.
2. **The client controls it.** Only an `org_admin` of the client creates a relationship, grants a role or revokes either. Revocation is effective on the next request.
3. **A partner is never an administrator of the client.** Grants take experiment roles only; roles with organization scope (`org_admin`, `governance`) are rejected. The partner gets no `org:manage`, `experiment:create` or `apikey:manage_all`.
4. **A grant lives only as long as the person belongs to the partner.** It counts only while the relationship and the grant are active and the person has been a member of the partner organization *since before* the grant. Removing someone from the consultancy (manually or via SCIM) cuts their access to every client at once, and re-adding them does not bring it back: the client has to grant it again.
5. **Permissions come from one place.** `resolveExperimentAccess` and `listExperimentsForUser` take the union of the organization role, the experiment role and the partner grants; no route compares role names (ADR-052).
6. **Cross-client views are metadata.** `GET /api/v1/partner/clients` returns the clients and experiments granted to the caller and the role; the data of a client opens through the ordinary experiment routes, which require the grant.
7. The history is kept in the tables (who granted, who revoked, when). A general audit log of *reads* is still a P1 item of ADR-087.

### API

For the client's `org_admin`: `GET|POST /organizations/{id}/partnerships`, `DELETE /organizations/{id}/partnerships/{partnershipId}`, `POST /organizations/{id}/partnerships/{partnershipId}/grants`, `DELETE …/grants/{grantId}`. For the consultancy person: `GET /partner/clients`.

## Answers to the open questions

- **Who owns the data when the contract ends?** The client organization owns it; the partner never holds a copy, only access. Ending the relationship removes the access immediately. Export and deletion on request remain P1 (ADR-087).
- **Unified list of clients for the consultancy?** `GET /partner/clients` provides the data; the dashboard home is pending.
- **Roles for partners?** The existing experiment roles, because roles are data: a client that wants read-only support creates an experiment role with just `experiment:read` and grants that.
- **One login, several organizations?** The experiment list already spans organizations, each item carries its organization; there is no "active organization" to select.

## Verification

- `tests/integration/partnerships.test.ts` (PostgreSQL 16, two clients with an experiment each that even share a service name, one consultancy with two people, one stranger): the relationship alone grants nothing; a grant gives exactly the role's permissions on that client and nothing on the other; a colleague who was not named has nothing; the partner is never an administrator; scoped grants and union of grants; the same grant again changes the role; the consultancy person sees only their clients; roles of organization level, strangers and foreign experiments are rejected; another client cannot see or touch the relationship; removing someone from the consultancy cuts access to all clients and re-adding does not resurrect it (this check failed before the timestamp rule); revoking a grant or the relationship is immediate and keeps the history; a new relationship does not resurrect old grants; one consultancy serves several clients independently.
- `tests/application/partnership-service.test.ts`: the rules of the service with a fake store.
- Full suite against PostgreSQL 16 and ClickHouse 23.8: 833 passed; the two failures (`annotation-queues`, `assistant-registry`) also fail on the branch without these changes.

## Not done

- Dashboard: a partners tab in the organization admin and the consultancy home with its clients.
- Granting people by email who are not yet members of the partner organization (invitations); today they must already belong to it.
- Annotation queues can only name experiment members as reviewers, so a partner person cannot be selected as a reviewer yet.
- The deployment access list of the assistant registry (ADR-053) shows members, not partner grants.

## Consequences

- **Positive**: the consultancy scenario is a first-class, safe-by-default use case; the client keeps control and can cut access at any time; offboarding at the consultancy propagates to all clients; the isolation boundary and the tenant model of the data (ADR-088) do not change.
- **Negative**: a second kind of access path to reason about in the authorization queries; the consultancy cannot see a unified view of its clients' data (by design); cross-organization identities need the person to exist in the partner organization first.
