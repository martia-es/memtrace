# ADR-093: Audit of Consultancy Access Reuses the Audit Log

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-087](adr-087-multi-tenant-security-baseline.md)
* **Related**: [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-091](adr-091-client-boundary-for-multi-client-organizations.md)

## Context and Problem Statement

When a consultancy operates a client organization ([ADR-091](adr-091-client-boundary-for-multi-client-organizations.md)), the client must be able to see who from the consultancy entered its data and when partner access was granted or withdrawn. While this was being built, a separate append-only `audit_events` table existed on a branch. Meanwhile [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md) shipped `audit_log` (service, API route, dashboard screen, `audit:read`, retention). Two logs would split what an `org_admin` has to read.

## Decision

Drop the separate table and write partner events to the ADR-084 `audit_log` with new actions:

| Action | Written when | Mode |
|---|---|---|
| `partnership.create` / `partnership.revoke` | The client creates or ends a partner relationship | strict (fails if it cannot be recorded) |
| `partner_grant.create` / `partner_grant.revoke` | The client grants or removes a role for a person of the partner | strict |
| `partner.access` | A person whose access to an experiment comes **only** from a partner grant passes the permission check | view (one entry per person and experiment every five minutes; never breaks the request) |

Entries carry identifiers and role names, never content. `partner.access` is written by `requirePermission` / `requireAnyPermission` when `ExperimentAccess.viaPartner` is true, so every route that checks a permission is covered without touching each route. The client reads them with the existing `GET /organizations/{id}/audit` and the Data protection screen.

## Consequences

- **Positive**: one log, one retention, one screen and one permission; the actions list is the only addition.
- **Negative**: routes that call `authorizationService.can()` directly instead of `requirePermission` do not record `partner.access` (listed as pending in the security roadmap). Reads by the client's own staff are still not logged.
