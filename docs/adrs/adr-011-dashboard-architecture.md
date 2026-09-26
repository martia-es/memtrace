# ADR-011: Dashboard Architecture (Vite + Vue 3 + Quasar)

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Roadmap piece 5 is a SPA built with Vite + Quasar and charts (ECharts/Recharts/D3), which may only talk to the query API (ADR-009) and never to the store. Decisions were needed on structure, how it shares the API contract, how it reaches the API, and how the trace timeline is drawn.

## Decision Outcome

1. **Stack**: Vite 8, Vue 3 (Composition API, TypeScript strict), Quasar 2 (components, dark mode; plain CSS, no Sass), Vue Router, ECharts 6 (tree-shaken, own chunk) only for time series.
2. **Hexagonal layout, same principles as ADR-008/ADR-009**:
   ```
   dashboard/src/
     domain/                 formatting, time-range presets, waterfall layout (pure TS)
     application/            TraceApi port + ApiError
     adapters/outbound/      HttpTraceApi (the only code that calls fetch)
     ui/                     inbound adapter: pages, components, composables, router, layout
     dependency-container.ts composition root; the API is provided with Vue provide/inject
   ```
   `domain`, `application` and `adapters/outbound` import neither Vue, Quasar nor ECharts; enforced by `tests/architecture.test.ts`. Tests inject a `FakeTraceApi`.
3. **One source of truth for the contract**: the dashboard imports the API's response types (`type`-only, erased at build) through the alias `@contract` → `api/src/adapters/inbound/http/contract.ts`, which was made self-contained for that purpose. No copies (ADR-009).
4. **Same-origin access, no CORS**: the Vite dev/preview server proxies `/api` to the API (`MEMTRACE_API_URL`, default `http://localhost:3001`). The Kubernetes counterpart (ingress/nginx path) is not built yet.
5. **State lives in the URL**: range, service, status, `hasErrors`, minimum duration and the selected span are query parameters, so any view is a shareable link and survives reloads. No global store: each page loads its data with `useAsync`, which aborts the previous request and ignores stale responses.
6. **Ranges are relative presets** (15 min … 30 d) resolved to absolute `from/to` at request time, so refresh and "live" (10 s, only while the tab is visible) move the window with the clock. Custom absolute ranges are not offered.
7. **Trace timeline is HTML/CSS, not a chart library**: a waterfall with collapsible tree rows, keyboard navigation (`role="tree"`, Enter/Space) and text labels is more accessible and simpler than an ECharts custom series. Bars are coloured by `memtrace.step_type`, errors in red; orphan spans and truncated traces show warnings.
8. **Lists use cursor "load more"** instead of numbered pages, matching the API's keyset pagination.
9. **UI language is Spanish**, strings inline (no i18n framework).
10. **Near-real-time by polling, on by default (5 s)**; no push channel. `useLiveRefresh` shares one persisted interval (Off/5/10/30 s) across pages, pauses in hidden tabs and refreshes immediately when they return, and skips a tick while a request is in flight. Live refreshes of the list are *merged* with what is loaded (older pages loaded with "load more" are kept; new traces are highlighted). The detail page polls only while the root span is missing (orphans, trace younger than 5 min), since spans arrive before their root.

## Consequences

- **Positive**: the UI cannot drift from the API (type-checked against the same file); logic is unit-testable without a browser or network; links are shareable; ECharts does not block first paint (180 kB gzip, separate chunk).
- **Negative**:
  - The dashboard build depends on the API source tree being present (`@contract`); a separate `contract` package would be needed if they are ever released independently.
  - The waterfall renders every visible row without virtualization; with the API's 5 000-span cap it is acceptable, and collapsing helps, but very large traces will be heavy.
  - No absolute date range, no i18n and no auth in Phase 1.
  - `jsdom` is pinned to 26 (v30 requires a newer Node than the project's 24.6).
  - Visual checks were done manually with Playwright screenshots; there is no visual-regression suite in CI.
  - Latency to screen is the sum of the SDK batch (default 5 s), the Collector batch (1 s) and the poll interval; measured 4-10 s. Polling costs the API/ClickHouse a list query per open tab per tick (the API's concurrency limit, ADR-009/010, bounds the damage). Server push (SSE) would remove the poll delay but needs a change-notification source that ClickHouse does not offer; not justified for Phase 1.
  - A trace only appears in the list once its root span ends (roots end last); long-running traces are visible in the list only when finished.
  - Packaging (Dockerfile, ingress) is pending; today it is served by `vite preview`/`vite dev`.
