# ADR-079: Network Segmentation and Collector Access

* **Status**: Pending
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-076](adr-076-multi-tenant-security-baseline.md)
* **Related**: [ADR-001](../infra/adr-001-otel-collector-clickhouse.md), [ADR-002](../infra/adr-002-local-kubernetes-k3d.md), [ADR-078](adr-078-ingestion-identity-binding.md)

## Context and Problem Statement

The manifests in `k8s/` define no `NetworkPolicy`. In practice:

- the OTel Collector listens on 4317 (gRPC) and 4318 (HTTP) and exposes a `ClusterIP` service without authentication; any pod in the cluster can send traces to it, skipping the API-key gateway entirely ([ADR-078](adr-078-ingestion-identity-binding.md) is bypassable);
- ClickHouse and Postgres accept connections from any pod, so a compromised or misbehaving workload (including a tenant-facing agent deployed in the same cluster) can read all tenants' data with the shared credentials;
- the gRPC OTLP port has no equivalent of the HTTP gateway at all.

Only the API, dashboard and docs pods set `runAsNonRoot`; ClickHouse, Postgres and the Collector do not declare it consistently.

## Proposed Decision

1. **Default deny** in the `memtrace` namespace (ingress and egress), then allow only the flows of the architecture:

| From | To | Port |
|---|---|---|
| Ingress controller / dashboard nginx | API gateway and API | 3001 |
| API (gateway) | Collector | 4318 |
| Collector | ClickHouse | 9000 |
| API and workers | ClickHouse, Postgres | 9000, 5432 |
| Migration and sync jobs | ClickHouse, Postgres | 9000, 5432 |
| API | DNS and the external hosts it needs (IdP, Resend, GitHub, LLM providers) | 53, 443 |

2. **The Collector accepts traffic only from the API gateway**: the policy allows 4318 from the API pods and closes 4317 to everything except an explicit, documented exception. Agents must send OTLP/HTTP through the gateway; gRPC to the platform is not offered until a gRPC gateway with key validation exists.
3. **Separate database credentials per component**: the query API uses a read-only ClickHouse user, the Collector a write-only one on `otel_*` tables, the evaluation writer keeps `api_writer` (ADR-045). Postgres gets one role per service.
4. **Pod hardening baseline** for every workload: `runAsNonRoot`, `readOnlyRootFilesystem` where possible, `allowPrivilegeEscalation: false`, dropped capabilities, resource limits, and a `restricted` Pod Security level on the namespace.
5. Policies are applied by the same `kustomization.yaml`. kind/k3d needs a CNI that enforces `NetworkPolicy` (for example Calico or Cilium); the default kindnet does not, so the local setup documents how to enable it.

## Verification

- A test pod in the namespace cannot reach the Collector, ClickHouse or Postgres; a pod with the API label can reach exactly its allowed targets.
- Sending OTLP straight to the Collector from another pod is refused; sending it through the gateway with a valid key works.
- `kubectl` conformance check in CI over the rendered manifests (no workload without `securityContext`).

## Consequences

- **Positive**: a compromised pod cannot read other tenants' data or inject traces; the gateway becomes the single authenticated write path.
- **Negative**: the local kind setup needs a different CNI and the policies must be maintained with each new component; debugging connectivity gets harder; agents that currently use gRPC against the Collector must switch to HTTP through the gateway.
