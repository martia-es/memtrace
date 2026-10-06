# ADR-059: Sidebar submenus instead of tabs inside pages

## Status
Accepted

## Context
Overview, Review and Evaluations each had their own tab bar inside the page (Overview had four plus one tab
per saved report). Users had to learn two navigation layers, the tabs were invisible until they opened the
page, and some views had no URL of their own (the Review tab lived in component state).

## Decision
- The sidebar keeps the five sections of ADR-048 but a section can have **children**, each one a route with
  its own URL. The group of the current page is expanded; the others stay collapsed. A group with one child
  renders as a plain item. With the sidebar collapsed, a group links to its first child.
- Menu tree (`MainLayout.vue`):
  - Overview: Summary, Compare, Custom charts, Reports
  - Conversations
  - Review: My inbox, All queues, Archived
  - Evaluations: Runs, Datasets, Trends
  - Costs
- Routes mark the active entry with `meta.section` (one value per child). Several routes may share one
  component and differ in `meta.view`: `MetricsPage` (`overview`, `overview/compare`, `overview/charts`,
  `overview/reports[/:reportId]`) and `AnnotationQueuesPage` (`annotation-queues`, `/all`, `/archived`).
- Saved reports stop being one tab each: **Reports** lists them and each opens at
  `overview/reports/:reportId`.
- "Offline evals" moves from Overview to **Evaluations → Trends** (`evaluations/trends`, `TrendsPage`),
  next to the runs it describes. "Compare runs" now links there.
- Old links keep working: `/overview?tab=compare|custom|offline` redirects to the new routes
  (`beforeEnter` on `overview`). Existing paths of Runs, Datasets and their detail pages do not change.
- Pages with a detail view of one object (dataset: Items / Versions / Runs; assistant; admin) keep their
  tabs: they are sections of one thing, not navigation of the app.

## Consequences
- Every view can be linked and survives a reload; the active range and filters travel in the query of each link.
- The tab counts (runs, datasets, queues) are gone; only the pending-review badge remains, on "Review"
  when collapsed and on "My inbox" when expanded.
- "Score configs" stays in Admin → experiment; it is not an Evaluations page yet.
- Adding a section means adding a child to `NAV` and a route with its `meta.section`.
