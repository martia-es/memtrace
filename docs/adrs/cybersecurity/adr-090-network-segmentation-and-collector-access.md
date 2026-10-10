# ADR-090: Network Segmentation and Collector Access

* **Status**: Accepted — implemented (2026-10-10). Not verified on a cluster that enforces `NetworkPolicy`; pod hardening of the databases is still open
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-087](adr-087-multi-tenant-security-baseline.md)
* **Related**: [ADR-001](../infra/adr-001-otel-collector-clickhouse.md), [ADR-002](../infra/adr-002-local-kubernetes-k3d.md), [ADR-088](adr-088-strict-tenant-isolation-in-clickhouse.md), [ADR-089](adr-089-ingestion-identity-binding.md)

## Context and Problem Statement

The ingestion gateway of ADR-089 only protects tenants if it is the *only* way to write traces. In the manifests as they were:

- the OTel Collector listened on 4317 (gRPC) and 4318 (HTTP) with no authentication, and `make up` forwarded both ports to the developer's machine, so any pod, or anyone on the machine, could write traces for any tenant;
- there was no `NetworkPolicy`: ClickHouse and Postgres accepted connections from any pod;
- every component connected to ClickHouse as `default`, the administrator. The API's "read-only client" was only a setting sent by the client itself;
- the documented local flow (README, `make dev-data`, the SDK defaults) sent traces straight to the Collector. After ADR-088 those traces carry no experiment and nobody can read them.

## Decision Outcome

Three independent layers, so that losing one (for example a CNI that does not enforce policies) does not reopen the path.

### 1. The Collector only talks to the gateway, and proves it

- OTLP **HTTP only** (4318). gRPC is removed: it would bypass the API-key validation and the identity assignment of ADR-089.
- `bearertokenauth` on the receiver. The gateway presents a shared token (`INGEST_INTERNAL_TOKEN`, secret `ingest-internal`); anything else gets `401` from the Collector itself. This works with any CNI.
- `make up` and `make forward` no longer forward the Collector. Agents use `http://localhost:8080/api/v1/ingest` with an API key, `make dev-data` requires `MEMTRACE_API_KEY`, and the README and docs-site say so.

### 2. Default-deny network policies (`k8s/05-network-policies.yaml`)

Default deny for ingress and egress in the namespace, DNS for everyone, then only the flows of the architecture:

| From | To | Port |
|---|---|---|
| dashboard (and `ingress-nginx` if present) | api | 3001 |
| api | otel-collector | 4318 |
| otel-collector | clickhouse | 9000 |
| api, health-probe, backfill, topic-extraction, model-pricing-sync, clickhouse-migrate | clickhouse | 8123, 9000 |
| api, health-probe, backfill, postgres-migrate | postgres | 5432 |
| api, health-probe, topic-extraction, model-pricing-sync | Internet, **excluding the cluster's pod and service CIDRs** | any |

The API needs arbitrary outbound destinations (identity provider, Resend, GitHub, LLM judges, the chat of each registered agent) and Kubernetes cannot filter by hostname, so it is allowed everywhere except the cluster's own networks: a compromised API cannot pivot sideways. The `except` list uses kind's default CIDRs and must be adjusted elsewhere. The dashboard and docs have no egress to the stores. Job and CronJob pods now carry an `app` label so policies can select them.

### 3. Least-privilege ClickHouse users (created by the migration Job)

| User | Used by | Privileges |
|---|---|---|
| `api_reader` (`readonly = 2`, cannot lift it) | API reads | `SELECT` on `memtrace.*` |
| `api_writer` (ADR-045) | API evaluation writes | `INSERT` on five evaluation tables |
| `collector` | OTel Collector | `INSERT` on the trace tables, `SELECT(Timestamp, TraceId)` on `otel_traces`, plus the `CREATE` grants the 0.96 exporter needs at startup |

The collector's grants were found by running the real exporter and adding only what it asked for: it cannot read span content, alter or drop anything. The materialized view that feeds the trace index runs with the inserting user's rights in ClickHouse 23.8, which is why `SELECT(Timestamp, TraceId)` is needed. Passwords are development placeholders in `k8s/10-clickhouse-secret.yaml`, like the existing ones; a real secret manager remains the P1 item of ADR-087.

### 4. Pod hardening (partial)

API, dashboard, docs, Collector, health-probe and backfill drop all capabilities, forbid privilege escalation and run as non-root. The Collector also uses `seccompProfile: RuntimeDefault`.

## Verification

- **Real Collector 0.96.0 against ClickHouse 23.8** (the deployed versions), using the config rendered from the ConfigMap: no token → `401`, wrong token → `401`, right token → `200`; the span lands in `otel_traces` with `ExperimentId` filled from the resource attribute and in the trace index; port 4317 is closed; no errors in the Collector log while running as the `collector` user.
- The migration Job script was executed verbatim against ClickHouse 23.8: it creates exactly the three users and grants shown above.
- `tests/integration/least-privilege.test.ts`: `api_reader` runs every read the API makes (including the topics join) and cannot insert, alter, drop, read `system.users` or lift `readonly`; `api_writer` cannot read or touch `otel_traces`; `collector` cannot read span content or write other tables.
- `tests/k8s-security.test.ts` (19 checks, mutation-tested): default deny exists, every workload is selected by a policy, only the API reaches the Collector and only on 4318, databases do not accept the dashboard or docs, Internet egress always excludes the cluster networks, no gRPC port anywhere, the API and the Collector read the token from the same secret, the users above.
- `make netpol-check` runs an unrelated pod against the Collector and reports whether the CNI enforced the policies.

## Not done / needs a cluster

- **The policies were never applied to a running cluster** (there is none in the environment where this was written). kind's default CNI may not enforce `NetworkPolicy`; run `make netpol-check` and, if it reports that the intruder pod reached the Collector, create the cluster without the default CNI and install Calico or Cilium. Until then layer 1 (the token) and layer 3 (database users) are what protect you.
- `kubectl port-forward` bypasses policies by design; it still reaches ClickHouse and Postgres for development.
- StatefulSets (ClickHouse, Postgres) and the Python jobs are not hardened beyond what they had: their images start as root and drop privileges, so `runAsNonRoot` and `drop: ALL` need testing on a cluster first.
- The topic-extraction, model-pricing and health-probe jobs and the backfill still connect as `default`; they need their own users.
- ClickHouse is deployed at 23.8 while the migration Job image is 24.3; align them.

## Consequences

- **Positive**: a pod that is not the gateway cannot write traces even if the network is open; the API cannot modify or drop data; the Collector cannot read what it stores; the agent flow is a single authenticated path.
- **Negative**: the local flow changed: agents need an API key and `http/protobuf` through the gateway, the SDK defaults (gRPC to `localhost:4317`) no longer work against this platform, and `make dev-data` needs `MEMTRACE_API_KEY`. The policies must be maintained with each new component, and the Collector depends on a shared token that has to be rotated together with its secret.
