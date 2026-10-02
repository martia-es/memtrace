# ADR-005: Persistent Volumes for ClickHouse and Persistent Queue in the Collector

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Without volumes, ClickHouse loses all data when its pod restarts, and the Collector keeps pending batches only in memory, so a ClickHouse outage or a Collector restart drops traces. The roadmap requires a persistent queue in the ingestion pipeline.

## Decision Outcome

1. **ClickHouse**: StatefulSet with a `volumeClaimTemplate` (10Gi, `ReadWriteOnce`) mounted at `/var/lib/clickhouse`.
2. **Collector queue**: `file_storage` extension backed by a 2Gi PVC mounted at `/var/lib/otelcol/queue`, referenced from the exporter with `sending_queue.storage`. Pending batches survive Collector restarts and are re-sent when ClickHouse is available.
3. The Collector Deployment uses the `Recreate` strategy (RWO volume cannot be shared by two pods). `fsGroup: 10001` plus an `initContainer` running `chown` guarantee the non-root container can write to the PVC, because k3d's `local-path` provisioner does not reliably honor `fsGroup`.
4. Retries: 5s to 30s backoff, up to 3600s (1h) per batch, then the batch is dropped and logged. Queue capacity is 5000 batches. Retrying indefinitely was rejected because a poisoned batch could block the queue head.
5. Readiness and liveness probes on both components; `memory_limiter` is based on an explicit container memory limit.

## Consequences

- **Positive**: data survives pod restarts; short ClickHouse outages do not lose traces.
- **Negative**:
  - Single-replica Collector: one instance owns the queue volume; scaling out requires a different design.
  - Deleting the PVCs (or the k3d cluster) still deletes data; backups are out of scope for Phase 1.
  - Batches older than `max_elapsed_time` (1h) are dropped; persistence bounds loss but is not a guarantee against long outages.
  - The 2Gi queue volume can fill during long outages under heavy traffic; no alerting in Phase 1.
  - The queue only protects Collector to ClickHouse. If the Collector is down, the SDK's in-memory batch queue drops spans by design (agents must never block).
