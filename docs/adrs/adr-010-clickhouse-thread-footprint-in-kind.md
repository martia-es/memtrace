# ADR-010: Reduce ClickHouse Background Threads to Fit the Kind Node PID Limit

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

While integration-testing the query API (ADR-009), six parallel queries left the local ClickHouse refusing every query, even `SELECT count()`, with `Cannot schedule a task: cannot allocate thread`, until the pod was restarted. Measurements in the running cluster (kind on Podman):

- The node container has a 2048-PID limit and **every container inside it is capped at `pids.max = 307`** (consistent with systemd's default `TasksMax` of 15 % of 2048; inferred, not verified in the node's systemd config).
- ClickHouse 23.8 with default settings uses **~300 threads idle**: `BgSchPool` 128, global `ThreadPool` ~50, `MergeMutate` 16, message-broker / distributed / buffer schedule pools 16 each, and 8 each for move / fetch / common. That leaves ~10 threads for queries.
- The global thread pool keeps free threads (`max_thread_pool_free_size` = 1000), so after a burst the container stayed at 307/307 instead of recovering.

Most of those pools serve features MemTrace does not use (Kafka, Distributed, Buffer, replication).

## Decision Outcome

Tune ClickHouse instead of the node, through a versioned config file mounted in `config.d`:

1. `k8s/config/clickhouse-low-footprint.xml`, generated into the ConfigMap `clickhouse-config` by kustomize and mounted at `/etc/clickhouse-server/config.d/low-footprint.xml`.
2. Values: `background_schedule_pool_size` 128→16; `background_message_broker_schedule_pool_size`, `background_distributed_schedule_pool_size`, `background_buffer_flush_schedule_pool_size` 16→2; `background_move_pool_size`, `background_fetches_pool_size` 8→2; `background_common_pool_size` 8→4; `max_active_parts_loading_thread_pool_size` 64→8; `max_thread_pool_free_size` 1000→32.
3. **`background_pool_size` (merges, mutations, TTL) is deliberately left at 16**: lowering it below ClickHouse's mutation thresholds can stop `ALTER ... DELETE` from ever running.
4. This ConfigMap keeps kustomize's **hash suffix** (the migrations ConfigMap keeps a fixed name because the Job references it), so editing the config changes the StatefulSet template and restarts ClickHouse on the next `kubectl apply -k .` / `make up`. Data stays on the PVC (ADR-005).
5. The API-side protections of ADR-009 (`readonly=2`, `max_threads` 2 per query, 3 concurrent queries) stay: they bound what one client can consume.

### Measured result (same cluster, same data)

| | Before | After |
|---|---|---|
| Threads/PIDs idle (limit 307) | ~300 | 128–142 |
| Headroom for queries | ~10 | ~165 |
| 12 parallel heavy queries × 5 threads (no API limiter) | (6 queries already exhausted it) | all `200`, peak 200 / 307 |
| PIDs after the burst | stuck at 307 | back to 142 |
| API integration tests (incl. `ALTER DELETE`) | failed under 6 parallel queries | 9/9 pass, also with 6 concurrent × 5 threads |

## Considered Alternatives

- **Raise the PID limit of the node** (Podman `pids_limit`, kubelet `podPidsLimit`, or systemd `DefaultTasksMax` inside the node). Not adopted: it is machine-level configuration outside the repo, kind nodes get their limits at creation so the cluster must be recreated (and the data in its volumes is lost), and it was not tried here. It remains valid if more components hit the cap.
- **Only API-side limits.** Necessary but insufficient: it leaves ~10 threads for everything, including the Collector's inserts and background merges.
- **More CPU/memory for the pod.** Unrelated: the cap is on process count, not on resources.

## Consequences

- **Positive**: ~16× more headroom without recreating the cluster or touching the machine; the fix is versioned and reproducible; a burst no longer leaves the server wedged.
- **Negative**:
  - Fewer background workers: slower parallel moves/fetches (unused today) and slower parts loading at startup (8 threads instead of 64). If Kafka, `Distributed`, `Buffer` or replication are added later, these values must be revisited.
  - Every config change restarts ClickHouse (brief unavailability; the Collector's persistent queue absorbs writes, ADR-005).
  - The remaining margin (~165 threads idle) is finite: about 30 heavy parallel queries at 5 threads would reach the cap. The API limits concurrency, but direct clients are not limited.
  - The cluster is still bound to the 307-PID container cap; other components share it. No alert exists for PID exhaustion in Phase 1.
- **Note**: ADR-002 names k3d, while the Makefile and the observed cluster use kind on Podman; that ADR is out of date and should be amended separately.
