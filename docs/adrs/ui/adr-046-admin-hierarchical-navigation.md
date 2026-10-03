# ADR-046: Admin Area as Hierarchical, Step-by-Step Navigation

* **Status**: Accepted
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The admin screen (`/admin`) put everything in one page: every organization as a card, every experiment inside it, and for each experiment four collapsible panels (members, score configs, API key, plus the invite modal). Organization appearance and the global member directory were on the same page too. Users could not tell what they were configuring, which options existed, or in what order to set up an agent. "Score configs" and "API key" looked like labels, not actions.

The screen had to answer one question at every moment: *where am I, and what can I change here?*

## Decision Outcome

### 1. Three levels, one per URL

| Level | Route | Contents |
|-------|-------|----------|
| 1. Organizations | `/admin` | One card per organization. Creating one lives here. |
| 2. Organization | `/admin/organizations/:organizationId` | Tabs: **Experiments** (everyone), **Members** and **Appearance** (`org_admin` only). |
| 3. Experiment | `/admin/experiments/:expId` | Tabs: **Connect**, **API keys**, **Score configs**, **Members** (`admin` / `org_admin` only). |

Plus `/admin/members`, the cross-organization member directory, reachable from level 1.

Every level has a breadcrumb (`MemTrace / Admin / Acme / Support bot`), so the user always sees where they are and can go back up.

### 2. One concern per tab, in the order a setup happens

The experiment page is ordered by the setup flow of an agent: **Connect** (what to put in the agent, with three numbered steps) → **API keys** (the credential) → **Score configs** (what gets evaluated) → **Members** (who sees it). Each tab explains in one line what it configures.

### 3. Tabs live in the URL

The active tab is stored in the query string (`?tab=keys`). Deep links work, the browser back button moves between tabs, and a reload keeps the user in place.

### 4. Creation and invitations

- Creating an organization or experiment stays in a modal: it is a single, discrete action with a few fields.
- Inviting people is an inline form inside the Members tab. The help text states the resulting role ("gets access to every experiment here" / "read-only").

### 5. Permissions are unchanged (ADR-016)

Tabs the user cannot use are not rendered at all, instead of being shown disabled. The data-loading rule of ADR-016 still applies: member lists are only requested for scopes the user can manage, to avoid cascading 403s.

### 6. Shared state, not a shared store

`useAdminDirectory()` (`dashboard/src/ui/composables/useAdminDirectory.ts`) loads organizations, experiments and members for each admin page on mount, and `reload()` refreshes them after a mutation. No Pinia-style store: the data is small, admin-only, and must be fresh when a page opens.

## Considered Options

* **Keep one page and only restyle it.** Rejected: the problem is the number of concerns per screen, not the styling.
* **Side drawer per experiment.** Rejected: a drawer on top of the list still hides the hierarchy, and nested drawers are hard to follow on narrow widths.
* **Wizard for creating an experiment that also sets up keys.** Rejected for now: keys are created on demand and may be rotated later, so forcing them at creation adds a step most admins don't need. The Connect tab guides the first-time flow instead.

## Consequences

* **Positive**: each screen has one purpose and states what can be configured. The setup order is explicit. Deep links and back navigation work for admin pages.
* **Negative**: more clicks to reach a single setting that used to be one expansion away. Accepted: the breadcrumb and the tab bar keep the cost low.
* **Routing**: the experiment route param is `expId`, not `experimentId`. A param named `experimentId` would make the router guard in `router.ts` treat the admin page as the active experiment and write it to `localStorage`.
* **Compatibility**: no API changes. The screen only reorganizes existing calls.
