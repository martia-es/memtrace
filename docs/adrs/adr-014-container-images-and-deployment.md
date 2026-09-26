# ADR-014: Container Images and Kubernetes Deployment of the API and the Dashboard

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Roadmap Phase 1 requires Kubernetes manifests with the five pieces as independent services. Pieces 1–3 (SDK, Collector, ClickHouse) were already in `k8s/`; the query API (piece 4) and the dashboard (piece 5) only ran on the developer's machine with `make dev`. They need images, manifests and a way to reach the dashboard.

## Decision Outcome

1. **API image** (`api/Dockerfile`): multi-stage `node:24-alpine`; Next.js `output: "standalone"` so the runtime image carries only what it needs (227 MB); runs as the numeric user `1000:1000` (Kubernetes cannot verify `runAsNonRoot` for a user given by name).
2. **Dashboard image** (`dashboard/Dockerfile`): Vite build served by `nginx-unprivileged` (52 MB). The build context is the **repository root**, because the dashboard imports the API's contract types (type-only alias `@contract`, ADR-011); a root `.dockerignore` keeps the context small. nginx serves the SPA with history fallback, caches hashed assets for a year and never caches `index.html`, and **proxies `/api/` to the API** (`API_UPSTREAM`, rendered from a template at startup): same origin, no CORS (ADR-009/ADR-011).
3. **Two independent Deployments and ClusterIP Services** (`k8s/50-api.yaml`, `k8s/60-dashboard.yaml`), listed in `kustomization.yaml`. The API reads ClickHouse through the in-cluster Service and the existing `clickhouse-credentials` secret; ClickHouse stays unexposed (ADR-002). Only the dashboard is reached from the host (`make up` port-forwards it to `localhost:8080`).
4. **Probes with different meanings**: API readiness = `/health/ready` (pings ClickHouse, so traffic stops when the store is down); liveness = `/health` (process only, so a ClickHouse outage does not restart the API). Non-root, no privilege escalation, all capabilities dropped, small requests/limits.
5. **No registry**: images are built locally (`make images`) and loaded into the kind node (`kind load image-archive`), with `imagePullPolicy: IfNotPresent`. They are tagged with the **fully qualified** name `docker.io/memtrace/…:dev`: Podman prefixes short names with `localhost/`, so a manifest saying `memtrace/api:dev` was not found (`ImagePullBackOff`); the qualified name works with Podman and Docker.
6. **`make up` builds and loads the images before applying** and waits for both rollouts; `make images` rebuilds them and restarts the pods. There is no hot-reload target: the cluster is the single way to run the stack (developers can still run `npm run dev` in `api/` or `dashboard/` by hand).

## Consequences

- **Positive**: the whole product comes up with one command; the deployment shape (proxy, probes, non-root) is versioned and testable locally; the API and the dashboard scale and fail independently.
- **Negative**:
  - Images are built from the **working tree**: a tree that does not type-check fails `make up` (intended fail-fast, but it couples the deploy to uncommitted work).
  - Every code change needs `make images` (image rebuild + rollout, 1-2 min) instead of hot reload.
  - Local-only images with a moving `:dev` tag; no registry, no CI build, no image scanning, no version tags.
  - No Ingress, TLS or authentication: the dashboard is exposed only through `kubectl port-forward` on localhost (the API has no auth either, ADR-009).
  - One replica each, no PodDisruptionBudget or autoscaling; root filesystem is writable; resource limits are estimates, not measurements.
  - The dashboard image build needs the API source tree next to it (`@contract`).
