# ADR-016: Admin Page Visible to Experiment Members, Scoped by Permission

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

`/admin` (`ExperimentsPage.vue`) rendered experiments nested inside a loop over `GET /organizations`, which only ever returned organizations the caller is `org_admin` of (ADR-013). A user with a direct **experiment** membership (`admin`/`member`) but no `org_admin` anywhere saw the page's empty state — "you don't belong to any organization" — even though `GET /experiments` correctly listed their experiment. Found while investigating a report that an invited user couldn't see the experiment they'd been added to: the invitation and membership were correct in Postgres, the problem was this page hid it.

That same member also had no self-service way to generate the API key needed to instrument their own agent: `POST /experiments/{id}/api-keys` required `canManageExperimentMembers` (`admin`/`org_admin`), a permission a plain `member` never has.

Two ways to fix the visibility gap:

- **A**: hide the Admin nav entry entirely from non-admins.
- **B**: show it to everyone, but scope each action (view org members, invite, create experiment, revoke a key) to the role that actually holds it, while letting any experiment member see their own access and self-serve an API key.

## Decision Outcome

**B.** A `member` needs their own API key to instrument the agent they have access to — that's the one action on this page that legitimately belongs to them, so it can't be hidden behind an admin-only nav item. Option A would also make future instances of this bug invisible to the person it affects, since they'd have no page to check their own access on at all.

### 1. `GET /organizations` now returns every organization visible to the caller, not just ones they administer

Broadened to `org_admin` **OR** "has at least one experiment membership inside this org", with a `myRole: OrgRole | null` field per row (`"org_admin"` or `null`). `GET /experiments` gained the analogous `myRole: "org_admin" | "admin" | "member"` (a listed experiment always has some access, so never `null`). New types `OrganizationSummary`/`ExperimentSummary` in `api/src/domain/identity.ts` carry this; the underlying `Organization`/`Experiment` entities are unchanged.

This alone fixes the original bug: an organization is now included in the list as soon as the user can see *any* experiment inside it, so `ExperimentsPage.vue` renders it instead of hiding the whole org (and its experiment) behind the org_admin-only empty state.

### 2. The Admin page renders the same tree for everyone, gated per action by `myRole`

- Org-level "Miembros" toggle, "Invitar org_admin", and "Nuevo experimento en {org}" only render when `myRole === "org_admin"` — the backend already 403s these for anyone else (`canManageOrganization`), so this is UI following existing authorization, not introducing new rules.
- Experiment-level "Miembros" toggle and "Invitar" only render when `myRole` is `"org_admin"` or `"admin"` (`canManageExperimentMembers`, unchanged).
- Rows the user can't manage show a small role pill instead, so they can still see *what* access they have even if they can't act on it.
- `refreshAllMembers()` (bulk-loads member lists for the count badges) now skips orgs/experiments the user can't manage, instead of calling `listOrgMembers`/`listExperimentMembers` and eating a 403 for every one of them.

### 3. API key generation is opened up to any experiment access, not just admin

`GET`/`POST /experiments/{id}/api-keys` now check `canReadExperiment` (any resolved access: `member`, `admin`, or `org_admin`) instead of `canManageExperimentMembers`. `DELETE` (revoke) is unchanged — still admin/org_admin only, and the "Revocar" button is hidden from members in the UI to match. This is the one deliberate broadening of the `member` role beyond "read-only" from ADR-013 §2: generating a key to instrument *your own* experiment isn't management of the experiment or of other people's access, it's the minimum needed to use the access you were already granted.

### What this does not solve

- No per-row indicator distinguishing "visible via org_admin" vs "visible via direct experiment membership" beyond the role pill — not needed yet, revisit if it causes confusion.
- The "Todos los miembros" directory at the bottom of the page still only shows rows for orgs/experiments the viewer can manage (since that's the only data fetched) — consistent with the rest of the page, not a separate decision.

## Consequences

- **Positive**: the page a person would naturally check to verify their own access ("can I see the thing I was invited to?") now actually shows it, for every role. Members can self-serve API keys without an admin's help. No new roles or authorization primitives — every gate maps to an existing `AuthorizationService` check.
- **Negative**: `GET /organizations` and `GET /experiments` are no longer "admin-only" in scope — any caller with any kind of access to an org's contents can now see that org's name and experiment count (not its members, not its other experiments outside their access — the query only surfaces orgs/experiments the union already grants visibility into indirectly anyway, so this is not a new information leak beyond what `GET /experiments` already exposed).
