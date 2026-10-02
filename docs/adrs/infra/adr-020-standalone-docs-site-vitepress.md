# ADR-020: Standalone Public Docs Site with VitePress

* **Status**: Accepted
* **Date**: 2026-09-28
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

MemTrace needs public documentation at `docs.memtraces.ai` covering (A) the Python library and (B) the platform. It must live outside the dashboard: the dashboard is an authenticated SPA tied to the query API, while docs are public, static and read by people who haven't signed in. `docs/` is already taken by internal design material (roadmap, ADRs).

## Decision Outcome

### 1. Separate deliverable in `docs-site/`

A new top-level folder with its own `package.json`, image and lifecycle. It shares no code with `dashboard/` or `api/` and has no runtime dependency on them, consistent with the roadmap's rule that each piece is independently replaceable. Internal docs (`docs/`) stay internal; the public site is written for users, not contributors.

### 2. VitePress (static site generator)

Markdown content, Vue/Vite underneath — the same ecosystem as the dashboard, so no new toolchain to learn. Provides built-in navigation, local search and light/dark themes, and outputs plain static files.

Alternatives rejected: Docusaurus (React, a second frontend stack), Nextra/Next.js (would tempt coupling with the API app), pages inside the dashboard (mixes public and authenticated concerns, forces docs deploys to follow dashboard releases).

### 3. Two sections mirroring the audience

- `/library/`: the `memtrace-ai` SDK (install, tracing API, conversations, integrations, configuration, agent authentication).
- `/platform/`: running and using MemTrace (local setup, dashboard, organizations and roles, query API, architecture).

### 4. Delivery: static files behind nginx

`docs-site/Dockerfile` builds the site and serves it with `nginx-unprivileged`, the same base as the dashboard. `k8s/70-docs.yaml` deploys it as an independent Deployment + Service, and `make images` / `make up` build, load and port-forward it (`http://localhost:8081`), so the full local stack includes the docs. It has no dependency on the other services. Public hosting under `docs.memtraces.ai` (DNS, provider) is an operational decision outside this repo's local stack. For hot-reload editing: `make docs`.

## Consequences

* Docs can be released without touching the platform, and vice versa.
* Content is duplicated in part with `sdk/python/README.md` and the root README; the site is the canonical user-facing reference and those files stay short.
* Docs must be updated by hand when the SDK or API contract changes; there is no generated API reference yet.
