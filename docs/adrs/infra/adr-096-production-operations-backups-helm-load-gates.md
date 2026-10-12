# ADR-096: Production Operations: Backups, Helm Chart and Load Gates

* **Status**: Accepted
* **Date**: 2026-10-12
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-002](adr-002-local-kubernetes-k3d.md), [ADR-005](adr-005-persistent-storage-and-queue.md), backlog item F8 ([docs/backlog.md](../../backlog.md))

## Context and Problem Statement

MemTrace runs today as plain manifests in `k8s/` on a local k3d/kind cluster (ADR-002). Each database is a single-replica StatefulSet with one PVC (ClickHouse 10 Gi, Postgres 5 Gi) and the Collector keeps its queue on a 2 Gi PVC (ADR-005). That is enough for development, but not for someone who stores real traces:

1. **No backups.** Losing a volume loses everything: traces and spans (ClickHouse) and identity, datasets, prompts, evaluations, alerts and the audit log (Postgres).
2. **No portable install.** Images, storage class, disk sizes, resources, ingress/TLS and secrets are fixed in the manifests.
3. **No performance gate.** `load-testing/agent_load_test.py` exists but only runs by hand, so a slow query or a lossy ingest path is found by users.

The three needs are separate pieces of work, but they share one decision: what MemTrace assumes about the environment it runs in. Deciding them one by one would produce three incompatible assumptions.

## Decision Outcome

### 1. Backups go to S3-compatible object storage, run as CronJobs

- One CronJob per database, in the same namespace, writing to an S3-compatible bucket configured by the operator. Locally the target is a volume or MinIO, so the same job runs in development.
- **Postgres**: `pg_dump` (custom format, compressed). WAL archiving / point-in-time recovery is out of scope until someone needs a recovery point tighter than the backup interval.
- **ClickHouse**: native `BACKUP ... TO S3` (or `clickhouse-backup` if the native command does not fit the pinned server version). Spans and traces are append-only, so full backups on a schedule are enough at first; incremental backups are an optimisation, not a requirement.
- **Retention of backups** is configured separately from the data retention of ADR-084. A backup keeps data that retention has already purged until the backup itself expires; this is a **documented limit**, and the default backup lifetime must not exceed the shortest data retention an organisation can set, unless the operator accepts it explicitly.
- A backup is only valid if it was restored once. The deliverable includes `make restore-test`, which restores into a scratch database and compares row counts.

### 2. A Helm chart is the production install; `k8s/` stays the local path

- Chart in `deploy/helm/memtrace/`, with values for images, `storageClass`, disk sizes, resources, ingress and TLS, and secrets.
- `k8s/` + Kustomize remain the development path (`make up`). A CI check renders the chart with default values and compares the resource set with Kustomize, so the two cannot drift silently.
- **Databases run in the cluster by default.** The chart accepts external connection settings for ClickHouse and Postgres so a managed service can replace them without forking the chart.
- **Secrets are normal Kubernetes Secrets** created from values or by the operator; the chart can reference pre-existing Secrets, which lets External Secrets or Sealed Secrets sit in front without a chart change. The chart does not bundle a secret manager.
- Component boundaries are untouched: the chart installs the same five pieces, with the same contracts (OTLP, HTTP/JSON) as the roadmap defines.

### 3. Load gates reuse the existing generator and run on demand

- The gate reuses `load-testing/agent_load_test.py` instead of introducing a second tool (k6, Locust).
- It measures lost traces (must be zero with the persistent queue), ingest rate, p95 of the query API and Collector memory against thresholds kept in a versioned file.
- It runs by `workflow_dispatch` and nightly, **not on every PR**: it needs a full stack and is slow. Thresholds are set from a measured baseline before the job is allowed to fail.

### Update (step 1, backups implemented)

- **ClickHouse backups run as a sidecar** (`clickhouse-backup` in the `clickhouse-0` pod, `k8s/20-clickhouse.yaml`) because the tool needs the data disk. A CronJob drives it through its authenticated API (7171, reachable only by the backup jobs through NetworkPolicy). `BACKUP ... TO S3` was ruled out: ClickHouse 23.8 does not support it reliably.
- **`create` is a hardlink on the data disk, so it cannot write to another volume** (`invalid cross-device link`). The copy that survives losing the disk is made by `upload`: to S3 when the `backup-s3` Secret exists, otherwise a real copy to the `backups` volume through the tool's `custom` remote storage. Local hardlinked copies stay 7 days on the data disk.
- **Expiry of the volume copies is done by the CronJob**, not by the tool: its `custom` list command did not parse in testing, and a delete with an empty name would have wiped the directory (the delete script refuses an empty name). In S3 the bucket lifecycle rule decides.
- **The restore test is real**: `make restore-test` restores the latest Postgres dump into `restore_check` and the latest ClickHouse backup into a `restore_check` database (`restore_database_mapping`), compares per-table counts and drops it. Verified on a live cluster: 48 Postgres tables and 11 ClickHouse tables matched.
- The sidecar must set `CLICKHOUSE_PORT=9000` explicitly: the Service named `clickhouse` makes Kubernetes inject `CLICKHOUSE_PORT=tcp://...`, which the tool reads as a number.

## Alternatives Considered

| Decision | Alternative | Why not |
|---|---|---|
| S3 backups | Snapshots of the PVCs (CSI VolumeSnapshot) | Depends on the CSI driver of each cluster and does not exist in k3d; a logical backup works everywhere and can be restored into a different version |
| S3 backups | A backup operator (Velero, Percona, CloudNativePG) | Heavier to install and tied to one database each; revisit if Postgres moves to a managed service or needs PITR |
| Helm | Kustomize overlays only | Fine for a handful of environments, awkward for third parties who need to set many values without editing manifests |
| Helm | Operator or a managed service as the only target | Fixes MemTrace to one provider and breaks the local/self-hosted promise |
| Reuse the load script | k6 or Locust | A second tool and a second traffic model to keep in sync with the SDK; the current script already speaks OTLP like a real agent |
| On-demand load gate | Run on every PR | Minutes of runtime per PR for a signal that changes rarely; nightly catches regressions within a day |

## Consequences

- **Positive**: data survives losing a volume; a third party can install MemTrace without reading the manifests; performance regressions get a number.
- **Negative**:
  - Two install paths (Kustomize and Helm) to keep equal; the CI render check is the guard.
  - Backups add an S3 dependency and credentials to manage.
  - A backup outlives the data retention of ADR-084 until it expires.
  - In-cluster databases remain single-replica: backups protect against loss, not against downtime. High availability is not part of this ADR.
- **Delivery**: three implementation steps, each on its own branch with its own user documentation in `docs-site/platform/operations.md`: (1) backups and restore test, (2) Helm chart, (3) load gate. This ADR is the step before them and is extended, not replaced, as the decisions above meet real clusters.
