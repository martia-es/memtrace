# ADR-093: Security Audit Log

* **Status**: Accepted — implemented (2026-10-10). Reads of trace data are not logged except consultancy access
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-087](adr-087-multi-tenant-security-baseline.md)
* **Related**: [ADR-091](adr-091-client-boundary-for-multi-client-organizations.md)

## Context and Problem Statement

ADR-091 promised that a consultancy entering a client's data leaves a trace the client can read, and ADR-087 listed the lack of an audit log as a P1 gap. Until now only dataset items, prompt tag moves and the deploy-gate bypass were audited, each in its own table. Nobody could answer "who gave this person access?", "who created this API key?" or "did the consultancy look at our data last week?".

## Decision Outcome

One append-only table, `audit_events` (migration 039), written by `AuditService`, readable by the organization's `org_admin`.

### What is recorded

| Action | When |
|---|---|
| `partnership.created` / `.revoked` | a client starts or ends a relationship with a consultancy (revocation records how many grants went with it) |
| `partner_grant.created` / `.revoked` | a client names a person, role and scope, or takes it away |
| `partner.access` | a person whose access comes **only** from a partner grant opens a client's experiment. One event per person and experiment per 10 minutes |
| `api_key.created` / `.revoked` | agent keys; only the public prefix is stored, never the key |
| `member.added` / `member.invited` / `org_admin.added` | membership changes |

Each event has the actor (id and the email at that moment), the organization and experiment, a target and a small `detail` with what explains it (role, scope).

### Properties

- **Append-only**: a trigger rejects `UPDATE` and `DELETE`.
- **Survives what it describes**: no foreign keys, so deleting the experiment, the organization or the person keeps the trail, which is why the actor's email is stored.
- **Fails loudly for actions**: if the event cannot be written, the action fails visibly instead of leaving no rationale. **Never breaks reads**: `partner.access` is throttled (it sits on the read path) and, if the store fails, the request goes ahead and the error is logged.
- **Scoped to the client**: `GET /api/v1/organizations/{id}/audit` (`org_admin` only, filter by `action`, paginate with `before`) returns that organization's events, including the consultancy's accesses.
- `ExperimentAccess` carries `viaPartner`, true only when no organization or experiment role exists, so staff of the client itself are never reported as partner access.

## Verification

- `tests/integration/audit.test.ts` (PostgreSQL 16): update and delete are refused; events outlive the deleted experiment with the actor's email; a full partnership story (create, grant, access twice, revoke grant, revoke) appears in order with exactly one `partner.access`; no key value ever appears; organizations do not see each other's events; filtering and paging; a normal member is not flagged as partner access.
- `tests/application/audit-service.test.ts`: throttling window and independence, failure behaviour for actions and for reads, page size cap.
- `tests/application/partnership-service.test.ts`: each partnership action records its event, and refused actions record nothing.

## Not done

- **Reads of trace data by the client's own staff are not logged**, and neither are consultancy reads through routes that do not use `requirePermission` / `requireAnyPermission` (a few use `authorizationService.can` directly). Logging every read needs a retention and volume decision.
- Logins, role changes made by SCIM or group mapping, and dataset/prompt changes keep their own histories.
- No retention policy and no export yet; no dashboard screen.

## Consequences

- **Positive**: the client can verify the consultancy model it was promised; security-relevant changes have a durable, tamper-resistant record.
- **Negative**: one more write in the request path of security actions; the table grows without a retention rule until one is chosen.
