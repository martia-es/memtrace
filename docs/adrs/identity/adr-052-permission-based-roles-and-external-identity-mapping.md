# ADR-052: Permission-Based Roles and External Identity Mapping

* **Status**: Accepted — phases A, B and C implemented (C without per-organization sign-in providers, see notes)
* **Date**: 2026-10-04
* **Deciders**: MemTrace Core Team
* **Supersedes in part**: [ADR-013](adr-013-identity-postgres-and-oauth-rbac.md) (the fixed `admin`/`member` experiment roles), [ADR-016](adr-016-admin-page-visible-to-experiment-members.md) (who generates API keys)
* **Depends on**: [ADR-013](adr-013-identity-postgres-and-oauth-rbac.md), [ADR-051](../evaluation/adr-051-explicit-queue-reviewers.md)

## Context and Problem Statement

ADR-013 fixed three roles: `org_admin`, `admin`, `member`. In practice `admin` became the technical profile (rubrics, queues, curation, datasets) *and* the person who invites, while `member` is both the business reviewer and a read-everything user. Authorization is spread over role comparisons (`access === "admin" || access === "org_admin"`) in route handlers, so every new profile means editing many files.

Two product needs make this untenable:

1. **Distinguish technical and business profiles**, with more profiles expected later.
2. **Customers will manage who-can-do-what in their own identity governance** (Microsoft Entra ID, SailPoint, Okta…). MemTrace must be able to receive that, not duplicate it by hand.

## Decision Outcome

Authorization is decided by **permissions**, not by role names. A role is a named set of permissions, stored as data. Roles are assigned to a user within a scope (organization or experiment), either manually or by an external source.

### 1. Permissions (the only thing code checks)

Named `resource:action`. Routes and UI ask `can(user, permission, scope)`; nothing outside the role catalogue knows a role name.

| Permission | Allows |
|---|---|
| `experiment:read` | Whole dashboard read-only: conversations (shown as a chat), metrics, costs, automatic evaluations, agreement |
| `trace:read_technical` | The span-level technical trace (span tree, span inspector, conversation tree) |
| `annotation:write` | Label traces; review queues where the user is a listed reviewer (ADR-051) |
| `queue:manage` | Create, edit and archive queues; add or retire items; choose reviewers |
| `queue:curate` | Queue Results tab: see every reviewer's answers, resolve disagreements, promote to a dataset |
| `scoreconfig:manage` | Create and edit rubrics |
| `dataset:write` | Create datasets and items, upload runs |
| `apikey:manage_own` | Create and revoke one's own API key for the experiment |
| `apikey:manage_all` | See and revoke every API key of the experiment |
| `member:manage` | Invite and change the roles of people in the experiment |
| `experiment:create` | Create experiments in the organization (organization scope) |
| `org:manage` | Organization settings, theme, organization members |

Being a reviewer of a given queue stays an attribute of that queue (ADR-051); `annotation:write` is necessary but not sufficient.

### 2. Built-in roles

| Role | Scope | Permissions |
|---|---|---|
| `org_admin` | organization | `org:manage`, `experiment:create`, `member:manage`, `apikey:manage_all` |
| `technical` | experiment | `experiment:read`, `trace:read_technical`, `annotation:write`, `queue:manage`, `queue:curate`, `scoreconfig:manage`, `dataset:write`, `apikey:manage_own` |
| `business` | experiment | `experiment:read`, `annotation:write` |

- The experiment-level `admin` role is **removed**. Managing people is `org_admin`'s job; managing content is `technical`'s.
- `org_admin` has **no** data permissions, so inviting people and issuing keys does not imply reading traces. Whoever also works in an experiment needs an explicit `technical` or `business` membership there. To avoid locking anyone out: the migration gives every existing `org_admin` `technical` on the experiments of their organization, and whoever creates an experiment is added to it as `technical`.
- Roles are rows, not an enum. A custom role (for example "technical without curation") is a new row with a chosen subset; no code change.

### 3. Data model

```
roles            (id, scope: 'organization'|'experiment', name, builtin bool)
role_permissions (role_id, permission)
memberships      (user_id, scope_type, scope_id, role_id, source: 'manual'|'external', external_ref NULL)
```

`organization_members` and `experiment_members` fold into `memberships`. Migration: every current `member` and `admin` becomes `technical` (nobody loses access today); `org_admin` keeps its name. Invitations (ADR-014) carry a `role_id` instead of a fixed role.

### 4. Resolution

`AuthorizationService.permissionsFor(userId, experimentId)` returns the union of permissions from the user's experiment membership and organization membership, resolved once per request. Route helpers (`requireExperimentAdmin` and friends) become `requirePermission("queue:curate", experimentId)`. `GET /experiments` and `GET /organizations` return `permissions: string[]` for the caller instead of `myRole`, and the dashboard shows or hides menus, tabs and buttons from that list. The role name is only a label.

### 5. External identity (SailPoint, Entra ID, Okta)

Same internal model, three ways in, in this order of delivery:

1. **Group/role claims at login.** The OIDC token's `groups` or `roles` claim (Entra app roles and groups; SailPoint-governed groups arrive the same way) are matched against `external_mappings (provider, external_group, scope_type, scope_id, role_id)`. On each login memberships with `source = 'external'` are reconciled: added when a mapped group appears, removed when it disappears. Manual memberships are never touched.
2. **SCIM 2.0** (`/scim/v2/Users`, `/Groups`) so SailPoint or Entra can provision and deprovision without waiting for a login. Group push uses the same `external_mappings`.
3. **Per-organization IdP configuration** (issuer, client, claim name) instead of the global Google/Microsoft apps, for customers who bring their own tenant.

Rules: an externally managed membership is read-only in the Admin UI ("managed by your identity provider"); losing the last external group removes access; mapping tables are managed by `org_admin` only; the permission catalogue stays internal, so customers map *their groups to our roles*, never to raw permissions.

### 6. Phasing

- **A (this change set)**: permission catalogue, `roles`/`role_permissions`/`memberships` tables, built-in roles, migration, `requirePermission`, `permissions[]` in the API, dashboard gating by permission, invitations with role.
- **B**: group/role claim mapping at login, `source` and read-only UI for external memberships.
- **C**: SCIM 2.0 and per-organization IdP configuration.

A is designed so B and C add only inputs (`source = 'external'` rows), never change the authorization path.

## Consequences

* Adding a profile is a database row plus, if it needs a new capability, one permission string.
* Every route that compared roles must be migrated; the compatibility cost is concentrated in phase A and covered by the existing authorization tests, extended per permission.
* `org_admin` without data access is a deliberate separation of duties, but means an organization creator must also add themselves to the experiment.
* The dashboard no longer branches on role names, so it needs no change when roles are added.

## Implementation notes (phase A)

* Migration `019_permission_based_roles.sql` creates `roles` and `role_permissions`, seeds the built-in roles, turns every `admin`/`member` into `technical`, and replaces the old `CHECK` constraints with foreign keys to `roles`. It is idempotent.
* **Deviation from section 3:** `org_memberships` and `experiment_memberships` were *not* folded into one `memberships` table yet. Their `role` column now references `roles`, which is all phase A needs. The merge, and the `source`/`external_ref` columns, move to phase B where external memberships first need them.
* `GET /experiments` and `GET /organizations` return `permissions` next to `myRole`; the dashboard decides from `permissions` only. `POST /experiments/{id}/members` validates `role` against the `roles` table.
* API keys: `apikey:manage_own` lists, creates and revokes only the caller's keys; `apikey:manage_all` sees and revokes all of them.
* Queue reviewer candidates are now the experiment's members only (an `org_admin` has no `annotation:write`). Adding traces to a queue needs `queue:manage`, previously any member.
* `trace:read_technical` is enforced in the API for `spans` and `conversations/{id}/tree`. `GET /traces/{id}` still carries spans because the review and conversation views are built from it, so for a `business` profile hiding the span tree is a UI rule there, not a data boundary. Closing that needs a conversation-only trace endpoint.

## Implementation notes (phases B and C)

* Migration `020_external_identity.sql`: `source` (`manual`/`oidc`/`scim`) on both membership tables, `external_mappings`, `organization_idp_settings` (the groups claim name), `scim_tokens` (hash only), and `scim_users` / `scim_groups` / `scim_group_members`.
* **Deviation from section 3 (again):** the two membership tables are still separate; they just gained `source`. Folding them into one `memberships` table would rewrite every query for no new capability, so it is dropped from the plan unless a later need appears.
* **One reconciliation, two inputs.** `ExternalAccessService` turns groups into roles with `desiredGrants` and calls `reconcile(user, organization, source, grants)`. Sign-in feeds it the token's groups (`events.signIn`); SCIM feeds it group membership. `reconcile` only touches rows of its own `source`, never overwrites or removes a `manual` membership, and never removes the last `org_admin` of an organization.
* **Safe by default:** a token without the groups claim (Google, or Entra's group overage with `_claim_names`) changes nothing. An empty list does remove access. A failure while reconciling is logged and never blocks sign-in.
* When two groups give different roles in the same experiment, the role with more permissions wins.
* **SCIM 2.0** lives at `/api/scim/v2` (`Users`, `Groups`, `ServiceProviderConfig`; `eq` filters, PATCH with or without `path`, Entra's text booleans), so it goes through the same `/api/` proxy as the rest. A bearer token belongs to one organization. A SCIM user is linked to the account by email, immediately or at first sign-in. Deactivating or deleting a SCIM user removes what SCIM gave them at once; deleting or adding a mapping recalculates SCIM users at once and OIDC users at their next sign-in (deleting the last mapping revokes the OIDC-given roles immediately).
* **Not done: per-organization sign-in providers** (own issuer, client id and secret per customer). It needs dynamic Auth.js providers and a secret store for client secrets, which the project defers until it has a secret manager (roadmap, phase 1.5). What exists per organization is the name of the groups claim. A customer can already federate through their own tenant by using Entra ID or Okta as the single sign-on provider, since mappings key off the claim, not the issuer.
* **Not done:** reading Entra's groups over Microsoft Graph when the token omits them (overage); until then those people are covered by SCIM or manual roles.

## Resolved Questions

1. `org_admin` does **not** read data by default (decided).
2. `business` sees the conversation only, not the technical trace (decided); hence `trace:read_technical`.
