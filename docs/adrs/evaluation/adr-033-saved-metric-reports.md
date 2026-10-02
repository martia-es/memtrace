# ADR-033: Saved metric reports (grid of custom charts, emailed as a snapshot)

## Status

Accepted. Builds on [ADR-027](adr-027-custom-metrics-on-custom-spans.md) and [ADR-030](adr-030-expand-custom-charts-builder.md).

## Context

ADR-027/030 let a user build and save individual custom charts (`custom_metrics`), shown as a flat grid in the Metrics page's "Custom charts" tab. Users now want to group several saved charts into a named, laid-out **report** per experiment — e.g. "Guardrail health" with 4 charts arranged the way they want — that:

1. Persists in the experiment, so any user with access to that experiment sees it too (same visibility rule as a saved chart today — read access is enough, per `canReadExperiment`).
2. Can hold several charts, each positioned and sized freely by the user (a grid, not a fixed list).
3. Can be emailed as a snapshot on demand.

Each report appears as its own tab in the Metrics page, next to Overview/Compare/Custom charts, so reports are navigation, not just another list.

## Decision

**Data model**: two new Postgres tables, additive to ADR-027's `custom_metrics` (migration `008_metric_reports.sql`):

- `metric_reports(id, experiment_id, name, created_by, created_at, updated_at)` — the report itself.
- `metric_report_charts(id, report_id, custom_metric_id, grid_x, grid_y, grid_w, grid_h)` — which saved charts appear in a report and where, on a 12-column grid (same convention as Grafana/Bootstrap). `custom_metric_id` references an existing `custom_metrics` row — **a report does not copy or fork a chart's definition**, it only arranges it. Editing a chart in "Custom charts" updates it everywhere it's used. Deleting the underlying chart removes it from any report via `ON DELETE CASCADE`.

A report's charts are replaced wholesale on save (`setMetricReportCharts` deletes and re-inserts the full set in one transaction) rather than diffed, because the grid editor always holds and submits the complete layout — simpler than tracking per-chart add/move/remove operations separately, at the cost of losing per-chart history (acceptable: layout, not data, isn't something we need to audit).

**RBAC**: identical to `custom_metrics` — every report endpoint (list/get/create/rename/delete/set-charts/send) requires only `canReadExperiment`, not `canManageExperimentMembers`. Reports are treated as working documents any contributor can shape, same as saved charts today; this is a deliberate continuation of ADR-027's stance, not a new primitive.

**Frontend grid editor**: `grid-layout-plus` (Vue 3 port of the common `vue-grid-layout`) renders and edits the `x/y/w/h` layout with drag and resize, in an explicit "Edit layout" mode on the report's tab — viewing a report never requires the grid library's interactive mode, only its static rendering.

**Navigation**: the Metrics page's tab bar becomes dynamic — one tab per saved report, added after Overview/Compare/Custom charts, plus a trailing "+" to create a new one. Quasar's `q-tabs` already scrolls when tabs overflow, so this doesn't need its own solution yet.

**Email snapshot (this ADR's scope only)**: a "Send by email" action on a report tab POSTs a list of recipient emails; the API recomputes every chart in the report server-side (reusing `TraceQueryService.getCustomMetric`, the same function the live dashboard calls) over a fixed recent window, and emails an HTML summary — one table per chart (label/value rows), not a rendered image — via a new `EmailSender.sendReportSnapshotEmail` method on the existing Resend-backed port from ADR-014. No PDF, no headless browser, no attachment: explicitly deferred (see below).

## Explicitly out of scope here

- **PDF export / visual snapshot.** There is no PDF or headless-rendering infrastructure anywhere in this codebase today. Adding one (e.g. Playwright) means a browser binary in the API/worker image, which has real build-size and deploy-time cost (this project already tunes image size for k8s jobs). Deferred to its own ADR once there's a concrete need and a decision on headless-render-the-page vs. redraw-charts-natively.
- **Per-recipient scheduling / recurring email digests.** Sending today is always on-demand, one-shot, synchronous — no queue or cron.
- **Restricting report management to admins.** Any experiment contributor can create, edit or delete a report, same as a saved chart.

## Consequences

- Two new tables, no change to `custom_metrics` or its API.
- `EmailSender` grows a second method; the Resend adapter gains an HTML-table email alongside the existing invitation email. Still synchronous, still no queue — fine for occasional on-demand sends, would need revisiting if reports are emailed to large recipient lists often.
- One new frontend dependency (`grid-layout-plus`) for drag/resize — isolated to the report view, doesn't affect ECharts rendering or the existing chart builder.
- The Metrics page's tab bar is no longer a fixed, hand-written list — it's generated from `listMetricReports`, which is a small but real shift from the static tabs introduced earlier.
