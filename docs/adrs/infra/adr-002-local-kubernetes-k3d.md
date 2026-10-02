# ADR-002: Local Kubernetes with k3d as the Runtime (Replaces Docker Compose)

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team
* **Supersedes**: the "Docker Compose" runtime stated in `docs/roadmap.md` (overview and Phase 1 deliverables), which has been updated accordingly.

## Context and Problem Statement

The roadmap originally assumed a Dockerized stack run with Docker Compose. The team decided to run MemTrace on Kubernetes from the start, so local development mirrors declarative, cloud-native deployments. A concrete local distribution had to be chosen (k3d, Kind or Minikube).

## Decision Outcome

- Runtime: **Kubernetes**, in a dedicated namespace `memtrace`.
- Local distribution: **k3d** (k3s in Docker).
- Manifests live in `k8s/`, applied with `kubectl apply -f k8s/`.
- All Services are `ClusterIP`. Only the OTel Collector is reachable from the host, through `kubectl port-forward`. ClickHouse is never exposed outside the cluster (only the query API may access it).

### Why k3d

| Option | Notes |
|---|---|
| k3d | Lightweight, fast startup, bundled `local-path` StorageClass (needed for PVCs, ADR-005) |
| Kind | Good for CI, but no default dynamic storage provisioner without extra setup |
| Minikube | Heavier; VM/driver variability across machines |

## Consequences

- **Positive**: environment close to production; declarative resources; PVC-backed persistence works out of the box.
- **Negative**:
  - Higher setup and memory cost than Compose; developers need Docker, k3d and kubectl.
  - The roadmap deliverable "Docker Compose with the 5 pieces" becomes "Kubernetes manifests for the 5 pieces".
  - Development secrets (ClickHouse password) are plain manifests for local use only.
