# ADR-098: Durable Ingestion Pipeline: Dedicated Ingest Service, Broker Between Collectors, Prometheus and Grafana

* **Status**: Accepted — not implemented yet (phases at the end). The broker product (Redpanda or Apache Kafka) is decided in phase 3 by a short spike
* **Date**: 2026-10-17
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-001](adr-001-otel-collector-clickhouse.md), [ADR-005](adr-005-persistent-storage-and-queue.md), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-085](../identity/adr-085-ingest-gateway-validates-service-name.md), [ADR-089](../cybersecurity/adr-089-ingestion-identity-binding.md), [ADR-090](../cybersecurity/adr-090-network-segmentation-and-collector-access.md), [ADR-092](../cybersecurity/adr-092-security-headers-and-ingest-rate-limits.md), [ADR-096](adr-096-production-operations-backups-helm-load-gates.md), [ADR-099](../storage/adr-099-deduplicated-span-storage.md)

## Context and Problem Statement

Traces reach ClickHouse through this path today:

```
SDK ──OTLP/HTTP──► API (ingest gateway) ──► Collector (1 pod, queue on a PVC) ──► ClickHouse (1 pod)
```

It works and loses nothing when ClickHouse is down for up to an hour (ADR-005), but it cannot run as several replicas, and the requirement is a pipeline that keeps no state in the pods that process traffic, tolerates the loss of any single component, handles high volume, and has the same topology locally and in a cloud. What stands in the way (checked in `k8s/`, the Helm chart and `api/src/app/api/v1/ingest/v1/traces/route.ts`):

1. **The Collector is a single point of failure with state.** `replicas: 1`, `strategy: Recreate`, queue on a `ReadWriteOnce` PVC (ADR-005). A second pod cannot mount that volume, and one volume per replica would leave each replica's pending batches stuck if it disappears. While the pod restarts nobody receives traces and the SDK drops spans after its 2,048-span in-memory queue.
2. **A small window of loss before the persistent queue.** The Collector answers "received" once the batch is in the `batch` processor (up to ~1 s in memory), before it reaches the file queue.
3. **Ingest and query share a process.** The gateway is a route of the query API. The roadmap rule (piece 2 and piece 4 are separate services, because their load profiles differ) is not met: an ingest spike degrades the dashboard.
4. **Per-replica rate limits** (ADR-092) are in memory, so with N replicas the real limit is N times higher.
5. **A Postgres query per request.** The gateway resolves the API key against Postgres on every call. With Postgres as a single pod, a Postgres outage stops all ingestion even when the rest is healthy.
6. **No metrics backend** (ADR-089 notes it). Without it nobody sees queue depth, lag or disk pressure; a buffer you cannot see fills silently.

## Decision Drivers

- No state in pods that process traffic; state only in the broker, ClickHouse and Postgres.
- High volume and spikes: absorb them without making ClickHouse the shock absorber.
- The SDK keeps speaking standard OTLP and needs only a URL and a key.
- Personal data is masked **before** it is stored anywhere (ADR-084).
- One topology, two sizes: local (1 of everything) and cloud (replicated), from one Helm chart (ADR-096).
- Operational weight must be justified: every new component needs metrics and a runbook.

## Decision Outcome

```
SDK ─OTLP─► ingest (xN) ─► Collector "entry" (xN) ─► BROKER (x3) ─► Collector "consumer" (xN) ─► ClickHouse (x1)
            stateless        stateless, no queue,       replicated    stateless, consumer group    ReplacingMergeTree
            key + tenant     masks PII, publishes       log, 24-72 h  large batches                (ADR-099)
```

### 1. `ingest`: its own stateless service

The gateway moves out of the query API into a service with its own Deployment and image (same code, same ADR-085/089/092 behaviour: validate the key, fix `service.name` and `memtrace.experiment_id`, size limits, rate limits). The query API loses the route. The SDK only changes the URL it points to.

- **Key cache with stale-if-error.** The result of resolving a key is cached for a short TTL (default 30 s). If Postgres is unreachable, a key that was valid within a longer bound (default 10 min) keeps being accepted; an unknown key is refused. A revoked key can therefore keep working for up to the TTL (and up to the bound during a Postgres outage). Revocation stays in Postgres; the cache is only a delay. Both values are settings.
- **Rate limits stay per replica and approximate**, as documented in ADR-092 (abuse protection, not a quota). A shared counter (Redis) is deferred until a quota is needed.
- Horizontal scaling by CPU (HPA). Metrics endpoint (see section 5).

### 2. A broker between two stateless Collector tiers (option B)

- **Entry Collector** (replaces the current gateway-facing Collector): receives OTLP/HTTP from `ingest` only (bearer token and network policy as in ADR-090), runs `memory_limiter` and `transform/pii`, and exports to the broker with the `kafka` exporter (`otlp_proto` encoding, `required_acks: all`). **It has no `sending_queue` and no `file_storage`**: the export is synchronous, so a broker error returns to `ingest` as a 5xx and the SDK retries. "Received" is therefore only said after the broker has acknowledged the replicated write. This removes the in-memory window of problem 2.
- **Consumer Collector**: `kafka` receiver with a consumer group, large `batch` (tens of thousands of spans), `clickhouse` exporter with the same retry settings as today. It keeps no queue on disk: what is not yet in ClickHouse is still in the broker.
- Both are the same image (`otelcol-contrib`) with different configuration, so the existing version pin and PII tests (`scripts/check_collector_pii.py`) keep applying.
- **Ordering is not required.** Spans of one trace may arrive in any order and from any partition; reads are by `TraceId`. The topic key is therefore optional (round-robin or `TraceId` if the exporter offers it; to be checked against the pinned Collector version in phase 3).
- **Delivery is at-least-once end to end.** Duplicates (SDK retry, gateway retry, consumer replay) are resolved in storage by [ADR-099](../storage/adr-099-deduplicated-span-storage.md); this ADR does not try to prevent them.
- **No dead-letter queue in the Collector.** The `kafka` receiver has none. A batch ClickHouse rejects permanently is retried within the exporter bounds and then dropped and counted (`otelcol_exporter_send_failed_spans`), which is an alert (section 5). A dead-letter topic is deferred until the first real case shows what it should contain.

### 3. Broker: Kafka API, product chosen in a spike

Requirements: Kafka-compatible API (the Collector has first-party exporter and receiver), replication, retention by time and size, runs in a single node locally and replicated in a cloud, and an external-cluster mode like the databases (`external.host` in ADR-096).

| Option | For | Against |
|---|---|---|
| **Redpanda** | Kafka API, one binary, lighter to run, good for a 1-node local mode | Newer; community edition is source-available (BSL), so the licence must be reviewed before adopting |
| **Apache Kafka (KRaft)** | The standard; fully open licence; largest ecosystem; managed offers everywhere | Heavier to operate and to run locally |
| NATS JetStream | Very light | Less mature Collector support; smaller ecosystem for this use |
| Pulsar | Native multitenancy | More components; no need for it here (tenancy is in the data) |
| RabbitMQ | Good task queue | Not a log: messages are removed on consume, no replay, weaker for continuous high volume |
| Redis Streams | Simple | Weaker durability and replication; memory-bound |
| Managed (MSK, Confluent Cloud, Event Hubs Kafka endpoint) | Nothing to operate | Cost and provider coupling; reachable through the external mode above |

**Decision**: a Kafka-API broker. The phase 3 spike compares Redpanda and Apache Kafka on: local footprint, licence review, one-node and three-node installs from the chart, and behaviour in the chaos test. Whichever wins, the chart exposes the same values.

Topic settings: one topic `otel-traces`; partitions ≥ the maximum number of consumer Collectors wanted (start at 12, a partition count can grow but changes key distribution); replication factor 3 and `min.insync.replicas` 2 in cloud, 1 and 1 locally; retention by time (default 48 h) **and** by size, so a stalled consumer cannot fill the disk silently.

### 4. Security

- The broker listens only inside the namespace. Network policy (extending ADR-090): `ingest` → entry Collector (4318), entry Collector and consumer Collector → broker, consumer Collector → ClickHouse (9000); nothing else reaches the broker.
- The broker holds prompts and completions for the retention window. PII of fixed format is masked before publishing (ADR-084 limit applies: names and free text are covered only by the SDK). Cloud values require encrypted volumes (StorageClass) and authenticated access (SASL, TLS) between components; local mode may run without them and says so.
- Retention of the topic is deliberately short; it is a buffer, not an archive. It does not replace the ClickHouse retention of ADR-084 and its purge keeps working on the stored data.

### 5. Metrics: Prometheus and Grafana in the chart

A buffer that cannot be seen is a risk, so monitoring ships with the broker (phase 2, before it).

- Prometheus scrapes: Collectors (`:8888`), `ingest` (`/metrics`, new), the broker, ClickHouse (built-in Prometheus endpoint) and kube-state/node metrics. Grafana ships with provisioned dashboards (pipeline health) and is **not** exposed through the public ingress; access by port-forward or an authenticated ingress configured by the operator.
- Minimum alert rules, versioned in the chart: consumer lag above a threshold for N minutes; broker disk above 70 %; `ingest` 5xx rate; permanent export failures (`otelcol_exporter_send_failed_spans`); broker replicas under-replicated; Postgres unreachable from `ingest`.
- Enabled by a chart value; on by default in the cloud values, off by default locally. Notification routing (Alertmanager receivers) is the operator's; the in-app alerts of ADR-086 are about agent quality and are a different thing.
- Prometheus and Grafana keep their own volumes; they are monitoring data, not part of the data contract, and are not covered by the backups of ADR-096.

### 6. Scaling and topology

| Piece | Local | Cloud |
|---|---|---|
| `ingest` | 1 | N, HPA on CPU |
| Entry Collector | 1 | N, HPA on CPU/memory |
| Broker | 1 node, RF 1 | 3 nodes, RF 3, or an external cluster |
| Consumer Collector | 1 | N ≤ partitions, KEDA on consumer lag (HPA on CPU as the fallback if KEDA is not installed) |
| ClickHouse, Postgres | 1 pod each (unchanged) | 1 pod each, or external |

Everything stays in `k8s/` and in the chart; `scripts/check-helm-parity.py` (ADR-096) keeps both in sync. The broker follows the `external.*` pattern of the databases.

### 7. What happens when something fails

| Failure | Behaviour |
|---|---|
| An `ingest` or entry Collector pod | The others serve; the SDK retries on errors |
| One of three broker nodes | Writes and reads continue (RF 3, min ISR 2) |
| A consumer Collector | The group reassigns its partitions; lag rises briefly |
| ClickHouse down | The broker accumulates; consumers drain the lag when it returns |
| ClickHouse down longer than the retention | The oldest messages expire: this is why the lag alert fires long before that |
| The whole broker | `ingest` returns 5xx, the SDK retries and keeps up to 2,048 spans, then drops. No chain is unbounded |
| Postgres down | `ingest` keeps serving cached keys for the stale bound (section 1) |

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Keep the single Collector and scale it vertically | Does not remove the single point of failure; no answer to the stateless requirement |
| Collector as a StatefulSet with a PVC per replica | Removes the shared-volume limit but keeps state in the pods: a replica that disappears leaves its pending batches stuck on its own volume, and the volume is bound to a zone |
| Shared volume (RWX: NFS, EFS) for the queue | Concurrent writers on a file queue are not supported by `file_storage`; slow and fragile |
| `ingest` publishes to the broker directly (option A) | One component and one hop fewer, but it puts a Kafka client in our code, ties the gateway to the broker product, and publishes unmasked content to the broker. B was chosen for decoupling and masking before the buffer |
| `async_insert` in ClickHouse only | Helps with small inserts but gives no buffer when ClickHouse is down |
| ClickHouse Kafka table engine or Kafka Connect sink instead of the consumer Collector | No PII masking step, harder to debug and scale (engine), or an extra platform to run (Connect) |

## Rollout

Each phase is a branch with its own test plan and leaves the system working. The migration of the span table (ADR-099) comes **after** the broker, because pausing the consumers during the table swap is lossless only when a broker holds the data.

1. **`ingest` service** split from the query API, key cache with stale-if-error. No change to the data path. Gate: ingest tests and `make load-gate`.
2. **Metrics**: Prometheus and Grafana in `k8s/` and the chart, `/metrics` in `ingest`, dashboards and alert rules.
3. **Broker and the two Collector tiers**, with the product spike. Cut-over: point `ingest` at the entry Collector; leave the old Collector running until its file queue is empty, then remove it and its PVC. Gate: end-to-end load test.
4. **Chaos in the load gate**: kill `ingest`, entry and consumer pods and a broker node during the run; zero lost spans while the broker is up, lag returns to zero.
5. **ADR-099 migration** (deduplication).
6. **Autoscaling** (HPA, KEDA) and tuning of partitions and batch sizes from real numbers.

## Update (2026-10-17): phase 1 implemented

- **Where it lives.** The gateway is `api/src/adapters/inbound/http/ingest-gateway.ts` (framework-free: a `Request` in, a `Response` out), the key cache is `api/src/application/api-key-cache.ts`, and the process is `api/src/ingest/server.ts` on plain `node:http`, bundled with esbuild into one file. It is the `ingest` target of `api/Dockerfile`, deployed by `k8s/55-ingest.yaml` and the chart. The route in the query API is gone.
- **Same public path.** It serves `POST /api/v1/ingest/v1/traces`; the dashboard nginx routes `/api/v1/ingest/` to it, so SDKs, `.env` files and docs are unchanged. nginx also gets `client_max_body_size 16m`, equal to the gateway limit; its default is 1 MB.
- **Least privilege, enforced by tests.** The pod has no ClickHouse or login credentials, a read-only filesystem, and a network policy that allows only Postgres and the Collector as destinations. The API no longer holds the Collector token and no longer reaches the Collector (`api/tests/k8s-security.test.ts`).
- **Retryable errors.** A failure of Postgres or the Collector answers `503` with `Retry-After` instead of `500`: OTLP exporters retry 429, 502, 503 and 504, not 500. A Collector call has a timeout (10 s).
- **Cache.** TTL 30 s and stale bound 10 min (`INGEST_KEY_CACHE_TTL_SECONDS`, `INGEST_KEY_CACHE_STALE_SECONDS`), keyed by the hash of the key, coalescing concurrent lookups, and with a 5 s back-off after a failure so requests do not each wait for the connection timeout. The Postgres pool has short timeouts for the same reason. A side effect: `api_keys.last_used_at` is refreshed at most once per TTL per key.
- **Health.** `/health` and `/ready` do not look at Postgres or the Collector on purpose. `/ready` turns `503` when the pod is draining (SIGTERM, 5 s, then it closes with requests in flight).
- **Load gate.** `load_gate.py` now forwards `svc/ingest` and the workflow builds and loads the `ingest` image.
- **Verified on the local cluster (2026-10-17).** Through the public path (dashboard nginx, `ingest`, Collector, ClickHouse): the tenant is stamped from the key, a foreign `service.name` gets 403, an invalid key 401, and the query API no longer serves the route (404). A revoked key keeps working inside the 30 s cache and is refused after it. With Postgres scaled to zero, a key validated recently is still accepted (the trace reaches ClickHouse), a never-seen key gets `503` with `Retry-After: 5`, the pod stays Ready, and it recovers by itself when Postgres returns. With two replicas, deleting one pod during 200 requests made none of them fail and all 200 reached ClickHouse. `make load-gate` passes (0 lost spans, 964 spans/s, query p95 47 ms) and `make netpol-check` confirms policies are enforced; a pod labelled `ingest` cannot reach ClickHouse, the API or the Internet. Not covered: with a single replica there is a short gap while the pod is replaced (the SDK retries); the Helm chart was not rendered here (no `helm` binary), so `scripts/check-helm-parity.py` runs in CI.

## Consequences

- **Positive**: no state in the processing tiers; any of them can be killed or scaled; ClickHouse outages are absorbed by the broker; ingest no longer competes with queries; the Postgres outage no longer stops ingestion; the same chart runs locally and in a cloud; masking happens before any buffer.
- **Negative**:
  - A new stateful component (the broker) with its own disk, upgrades and runbook, and two more Collector deployments.
  - One more network hop and a higher end-to-end latency per span (still seconds, bounded by the SDK batch interval).
  - At-least-once delivery means duplicates reach storage until ADR-099 is in place; phases 3 and 5 should not be separated for long.
  - A revoked API key can stay valid for the cache TTL.
  - The broker stores prompts and completions for up to the retention window; encryption at rest and access control are the operator's responsibility in cloud values.
  - The Collector version (0.96.0) is old: the options of the `kafka` exporter and receiver must be verified in phase 3, and the pin may need to move (with `scripts/check_collector_pii.py` as the regression test).
- **Not decided here**: Redpanda against Apache Kafka (phase 3 spike); a dead-letter path; a shared rate limit counter; high availability of ClickHouse and Postgres (a managed service or replicated cluster, outside this ADR).

## Verification

- Load gate extended with kill-and-recover steps (phase 4); the zero-loss check counts rows in ClickHouse for a unique `service.name`, as `load_gate.py` already does.
- Test: stop the entry Collector's broker connection; `ingest` answers 5xx and nothing is reported as received.
- Test: Postgres unreachable; a cached key is accepted, an unknown key is refused, and the stale bound is honoured.
- Test: `kubectl scale` the consumer Collector from 1 to N and back with a backlog; lag drains without gaps.
- Test: the PII tests of the Collector pass against the entry configuration.
