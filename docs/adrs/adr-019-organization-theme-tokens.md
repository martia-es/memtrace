# ADR-019: Per-Organization Theme via CSS Custom Property Overrides

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The dashboard's visual language is a single fixed set of `--mt-*` CSS custom properties (`src/styles/app.css`), shared by every organization (ADR-017 for dark theme, ADR-018 for the border-radius scale). An `org_admin` asked to give their organization a bit of visual identity — an accent color and a corner style — without forking the design token system per tenant.

## Decision Outcome

### 1. Theme lives on the `Organization` row, not a new store

`organizations.theme` (Postgres `JSONB`, default `{}`) holds `{ accentColor: string | null, radiusPreset: "sharp" | "soft" | "round" | null }`. This reuses the existing identity store (ADR-013) instead of introducing a third stateful service — theme is presentation metadata of an organization, not a new domain concept.

### 2. Deliberately 2 dimensions, not a full theming system

- **Accent color**: a single hex value (`--mt-accent`). The contrasting ink color (`--mt-accent-ink`, text drawn on top of the accent) is computed client-side from relative luminance (WCAG formula), not asked from the admin — one less decision, and it can't produce an unreadable combination.
- **Border-radius**: 3 presets (`sharp` = today's default per ADR-018, `soft`, `round`), each fixing `--mt-radius-xs/sm/lg` together. A free-form px value was considered and rejected: it can desync the 3 tokens (e.g. a large radius on `xs` looks wrong next to an unrounded `lg`), breaking the coherence ADR-018 established.

Other tokens (colors in `palette.ts`, typography, dark/light backgrounds) are not configurable: `SPAN_COLORS`/`CHART_COLORS` are MemTrace's own visual identity for span kinds, independent of any organization's branding.

### 3. Applied at runtime as `:root` custom property overrides

`applyOrganizationTheme()` (`dashboard/src/ui/composables/useOrganizationTheme.ts`) sets or removes `--mt-accent`, `--mt-accent-ink`, `--mt-radius-xs/sm/lg` on `document.documentElement`. A `null` field removes the override, falling back to the static default in `app.css`. This sits above both light and dark mode (ADR-017's `body.body--dark` block) without duplicating theme logic — an org's accent color applies the same way regardless of light/dark.

It is applied from `MainLayout.vue`, watching the current experiment (which already carries `organizationTheme` embedded — see below), and re-applied immediately after a save in the admin UI (`ExperimentsPage.vue`) for instant feedback.

### 4. Theme embedded in `GET /experiments`, no extra request

Rather than have `MainLayout` fetch `GET /organizations` separately to resolve the current experiment's org theme, `ExperimentSummary`/`ExperimentDto` carries `organizationTheme` directly — the existing `listExperimentsForUser` query already joins `organizations`, so this is one extra selected column, not a new query.

### 5. Authorization: reuses the existing `org_admin` check

`PATCH /organizations/:id/theme` uses `AuthorizationService.canManageOrganization` (same check as inviting members, ADR-013/ADR-016) — no new permission concept.

## Consequences

- **Positive**: no new data store; theme changes are visible instantly without a page reload; the 2-dimension scope keeps the admin UI to one small panel instead of a full theme editor.
- **Negative**: `/admin` (no `:experimentId` in the route) currently shows no organization accent in the sidebar/shell, since theme application is keyed off the current experiment — an acceptable gap given `/admin` is a management screen, not a branded surface.
- **Negative**: only 2 dimensions are configurable; a future request for more (e.g. logo, font) would need its own ADR rather than silently growing this JSONB blob.
