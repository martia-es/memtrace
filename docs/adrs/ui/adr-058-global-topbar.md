# ADR-058: Global topbar fed by the pages

## Status
Accepted

## Context
Each page drew its own header (breadcrumb, title, range filter, live refresh), so the
controls moved around and the layout did not match the approved design (52 px topbar:
title/breadcrumb on the left; time range and "Live" on the right).

## Decision
- `MainLayout` renders a single 52 px `topbar` above the scrolling content, with two slots
  (left: breadcrumb/title, right: filters and actions).
- Pages do not render a header: `PageHeader` and the detail pages' breadcrumbs use
  `TopbarSlot`, a `Teleport` into those slots (targets kept in `useTopbar`). Without a
  topbar (a page mounted on its own, e.g. in tests) the content renders in place.
- Routes that fill no left slot show `route.meta.title`.
- `FilterBar` is the range segmented control: the presets plus "Custom" (two dates, full
  days in local time, kept in the URL as `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`); `LiveControl` is a "Live/Paused" pill
  whose menu holds the interval and "Refresh now".

## Consequences
- New pages get the topbar by using `PageHeader`; no per-page layout work.
- The leading "MemTrace" crumb is dropped (the sidebar already shows the brand).
- Teleport targets are module state: one topbar per app.
