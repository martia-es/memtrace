# ADR-018: Centralized Border-Radius Tokens

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The dashboard's visual language was moving toward a minimal, low-rounding look (see the login page and `MainLayout` flat white redesign). Border radii were hardcoded per component (`4px` to `28px`, plus `999px` pills), inconsistently, across ~20 files. Changing the overall "roundness" of the app meant editing every component individually, with no single source of truth — the same problem `--mt-*` color tokens already solve for color (ADR-017).

## Decision Outcome

### A 3-step radius scale, alongside the existing `--mt-*` color tokens

`src/styles/app.css` defines:

```css
--mt-radius-xs: 4px;   /* tiny elements: code chips, small icon badges */
--mt-radius-sm: 6px;   /* default: buttons, inputs, pills, nav items, badges */
--mt-radius-lg: 8px;   /* larger surfaces: cards, modals, panels */
```

Every hardcoded `border-radius` value in the dashboard (previously ranging up to `28px`, plus `999px` pill shapes) was mapped to the nearest of these three tokens. This includes former pill-shaped elements (`.mt-pill`, `.mt-segmented`, `.toggle-group`), which are now small-radius rectangles rather than fully rounded — consistent with the "minimum rounding everywhere" direction.

Circular elements (`border-radius: 50%` — avatars, dots, round icon buttons) are left untouched: they are a shape choice, not a "how rounded" choice, so they don't belong on this scale.

### Scope

Applied across all `.vue` files under `src/ui/`, plus `src/styles/app.css` itself. Values found in inline `extraCssText` strings passed to ECharts (`MetricsPage.vue`) were included too, since those strings render as real DOM/CSS and inherit the same custom properties.

## Consequences

- **Positive**: the app's overall roundness is now a 3-line edit in one file. Any new component should reach for `var(--mt-radius-*)` instead of a literal pixel value.
- **Negative**: `--mt-radius-sm` and `--mt-radius-xs` collapse several previously-distinct sizes (e.g. `12px`, `14px`, `18px`, `999px` all became one value) into fewer visual steps — an intentional simplification, not a bug, but a real reduction in the previous design's granularity.
