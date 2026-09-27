# ADR-017: Dark Theme via `--mt-*` Design Tokens

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The dashboard was built light-only: `main.ts` hardcoded `config: { dark: false }` in Quasar, and `chart-theme.ts` already shipped a dark color palette for charts that was never reachable. The user menu needed a way to switch theme, which meant deciding how dark mode is actually implemented across the app, not just flipping a Quasar flag.

## Decision Outcome

### 1. Dark values live as overrides of the existing `--mt-*` tokens

All shared colors are already CSS custom properties defined once in `src/styles/app.css` (`--mt-bg`, `--mt-card`, `--mt-ink`, `--mt-accent`, etc.) and consumed by every component. Dark mode adds a second block, scoped to `body.body--dark` (the class Quasar's `Dark` plugin toggles on `<body>`), redefining the same variable names. No component needed to change: anything already using `var(--mt-*)` picks up dark values automatically.

### 2. Theme state: a small composable, not a Quasar-only toggle

`src/ui/composables/useTheme.ts` holds a module-level `theme` ref (`"light" | "dark"`), persisted to `localStorage` (`memtrace.theme`) — same pattern as `useLiveRefresh.ts`. A `watch(..., { immediate: true })` calls Quasar's `Dark.set()`, which both toggles the `body--dark` class (driving the CSS above) and updates `$q.dark.isActive` (already read by `chart-theme.ts` for chart colors). The composable is imported once at boot (`main.ts`) so the persisted theme applies before first paint, and again from `UserMenu.vue` to expose `theme`/`toggle` to the menu item.

### 3. What this does not solve

- Only the shared `--mt-*` tokens got dark values. A handful of page-specific hardcoded hex colors (decorative backgrounds in `ConversationsPage.vue`, `MetricsPage.vue`, `SpanTree.vue`, etc.) were left as-is and may look inconsistent in dark mode — follow-up work, not part of this decision.
- No "system preference" (`prefers-color-scheme`) auto-detection; the user picks explicitly from the menu and it's remembered.

## Consequences

- **Positive**: theme is a pure CSS-variable swap — new components get dark mode for free as long as they use `var(--mt-*)` instead of hardcoded colors.
- **Negative**: components that hardcode hex colors instead of tokens silently opt out of dark mode; worth a lint/review habit rather than a one-time fix.
