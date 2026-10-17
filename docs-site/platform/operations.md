# Operations: install, backups and performance

How to install MemTrace on a real Kubernetes cluster, how to keep its data safe and prove you can get it back, and how to check that it keeps up with your traffic.

## Install with Helm

`make up` is for your laptop. For a shared cluster, use the Helm chart in `deploy/helm/memtrace`. It installs the same pieces: ClickHouse, Postgres, the Collector, the API, the dashboard and the docs.

You need a cluster with a default StorageClass, Helm 3, and the MemTrace images in a registry the cluster can pull from (build them with `make images` and push them, or use your CI).

1. Write a `my-values.yaml` with what is yours:

```yaml
publicUrl: https://memtrace.example.com
images:
  api:       { repository: registry.example.com/memtrace/api, tag: "1.0.0" }
  dashboard: { repository: registry.example.com/memtrace/dashboard, tag: "1.0.0" }
  docs:      { repository: registry.example.com/memtrace/docs, tag: "1.0.0" }
  # modelPricing, modelQuality and topicExtraction work the same way
storage:
  className: fast-ssd          # empty = the cluster default
  clickhouse: { size: 100Gi }
ingress:
  enabled: true
  className: nginx
  host: memtrace.example.com
  tls: { secretName: memtrace-tls }
secrets:
  oauth:                       # Google / Microsoft login
    googleClientId: "..."
    googleClientSecret: "..."
  resend:
    apiKey: "..."
    emailFrom: "MemTrace <invites@example.com>"
```

2. Install it:

```bash
helm install memtrace deploy/helm/memtrace -n memtrace --create-namespace -f my-values.yaml
kubectl -n memtrace rollout status deployment/api
```

Do not add `--wait`: one volume stays `Pending` until its first job runs, and Helm would wait for it.

The database migrations run as jobs on every install and upgrade (`kubectl -n memtrace get jobs`). To upgrade, change the values or the image tags and run `helm upgrade` with the same `-f`.

### Passwords and secrets

By default the chart **generates** the passwords (ClickHouse, Postgres and the internal ingest token) the first time and keeps them on every upgrade. Read one with:

```bash
kubectl -n memtrace get secret clickhouse-credentials -o jsonpath='{.data.password}' | base64 -d
```

If you manage secrets elsewhere (External Secrets, Sealed Secrets, Vault), set `secrets.create: false` and create these Secrets in the namespace yourself:

| Secret | Keys |
|---|---|
| `clickhouse-credentials` | `password`, `writer-password`, `retention-password`, `reader-password`, `collector-password` |
| `postgres-credentials` | `password` |
| `ingest-internal` | `token` |
| `identity-oauth-credentials` | `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_APPLICATION_ID`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_SECRET` |
| `resend-credentials` | `RESEND_API_KEY`, `EMAIL_FROM` |
| `github-app-credentials` (optional) | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` |
| `backup-s3` (optional) | `bucket`, `prefix`, `region`, `endpoint`, `access-key-id`, `secret-access-key` |

### Use a managed database

Set `clickhouse.external.host` and/or `postgres.external.host` and the chart does not deploy that database. Its `clickhouse` / `postgres` Service becomes an alias to your host, so nothing else changes. Two things to know:

- ClickHouse backups (below) are turned off for an external ClickHouse: use your provider's backups.
- The network policies only know the databases of the chart. Set `networkPolicy.enabled: false`, or add rules for your host.

### Network policies

They are on by default and need a network plugin that enforces them (Calico, Cilium). Set `networkPolicy.ingressNamespace` to the namespace of your ingress controller and `networkPolicy.internalCidrs` to your cluster's pod and service ranges, so the API cannot reach them. The `ingest` service talks only to Postgres (to check API keys) and to the Collector.

## Backups and restore

MemTrace keeps traces in ClickHouse and everything else (users, datasets, prompts, evaluations, alerts, audit log) in Postgres, so a backup covers both.

## What runs by default

Every night, with no setup, MemTrace backs up both databases:

| Database | When (UTC) | What is saved | Kept for |
|---|---|---|---|
| Postgres | 02:30 | A compressed `pg_dump` of the identity database | 7 days |
| ClickHouse | 02:45 | A backup of the `memtrace` database (traces, spans, scores, feedback), taken by the `clickhouse-backup` sidecar | 7 days |

Both go to the `backups` volume of the cluster. That protects you from a bad delete or a bad migration, but **not from losing the disk the cluster runs on**. For that, send the copies to a bucket (next section).

Run a backup now, without waiting for the night:

```bash
make backup
```

## Send backups to a bucket (S3 or compatible)

With Helm, set `backup.s3.bucket`, `accessKeyId`, `secretAccessKey` (and `region`, `prefix`, `endpoint`) in your values and the chart creates the Secret. Otherwise create a Secret called `backup-s3` in the `memtrace` namespace. As soon as it exists, both jobs upload every backup to the bucket as well (AWS S3, MinIO, Cloudflare R2, etc.).

```bash
kubectl -n memtrace create secret generic backup-s3 \
  --from-literal=bucket=my-memtrace-backups \
  --from-literal=access-key-id=... \
  --from-literal=secret-access-key=... \
  --from-literal=region=eu-west-1 \
  --from-literal=prefix=memtrace \
  --from-literal=endpoint=https://s3.example.com   # only for non-AWS storage
kubectl -n memtrace rollout restart statefulset/clickhouse   # the ClickHouse sidecar reads it at start
```

Backups land under `<prefix>/postgres/` and `<prefix>/clickhouse/`. **The bucket decides how long they live**: add a lifecycle rule (for example, expire after 30 days). MemTrace does not delete from the bucket.

## Prove a backup works

A backup you never restored is a guess. This restores the latest copy of each database into a **temporary** database, compares every table with the real one and removes the temporary database. Your real data is not touched.

```bash
make restore-test
```

It prints one line per table with the rows in the copy and in the live database, and ends with `OK` for each database. A few rows of difference are normal: they are changes made after the backup. It fails if a table is missing or the copy is empty.

Do this after setting up the bucket and after any upgrade of MemTrace.

## Restore for real

Restore only after you have decided that the live data is wrong or gone.

**Postgres**: restore the dump you want into the database.

```bash
kubectl -n memtrace exec -i postgres-0 -- pg_restore -U memtrace -d memtrace_identity --clean --if-exists < memtrace_identity-<date>.dump
```

Copy the dump out of the `backups` volume first (or download it from the bucket).

**ClickHouse**: ask the sidecar to restore a backup. `rm=true` drops the existing tables first.

```bash
kubectl -n memtrace port-forward clickhouse-0 7171
curl -u backup:<clickhouse password> "localhost:7171/backup/list"                 # names and where each one is
curl -u backup:<clickhouse password> -X POST "localhost:7171/backup/download/<backup-name>"   # only if it is not local
curl -u backup:<clickhouse password> -X POST "localhost:7171/backup/restore/<backup-name>?rm=true"
```

Stop the Collector (`kubectl -n memtrace scale deployment/otel-collector --replicas=0`) while you restore and start it again afterwards.

## Good to know

- **Data retention and backups.** Retention (see [Data protection](/platform/data-protection)) deletes old traces from ClickHouse. A backup taken before the deletion still has them until the backup itself expires. If you need data gone for good, keep the backup lifetime no longer than your shortest retention.
- **Backups protect against loss, not downtime.** Each database runs as a single instance. If it is down, MemTrace is down until it is back.
- **Disk space.** Backups live in a 5 Gi volume by default. Resize the `backups` PersistentVolumeClaim if your traces are large.
- **A failed backup is visible.** `kubectl -n memtrace get jobs` shows the last runs; a failed one keeps its logs (`kubectl -n memtrace logs job/<name>`).

## The ingestion pipeline (Kafka)

Traces do not go straight from the Collector to ClickHouse. They pass through **Apache Kafka**, so that nothing is lost when ClickHouse is slow or down, and so that no pod that handles traffic keeps data of its own:

```
agent → ingest → Collector (entry) → Kafka → Collector (writer) → ClickHouse
```

- **`ingest` and the entry Collector** hold nothing: you can restart or scale them. The entry Collector masks personal data (a fixed-format subset, see [Data protection](/platform/data-protection)) and publishes to Kafka. It answers "received" only after Kafka has confirmed the write on every in-sync replica; if Kafka cannot, `ingest` answers `503` and the agent retries.
- **Kafka** keeps the traces for **48 hours** or **512 MiB per partition**, whichever comes first. It is a buffer, not an archive: your retention of traces is the one of ClickHouse ([Data protection](/platform/data-protection)).
- **The writer Collector** reads in a group and writes to ClickHouse. If ClickHouse is down, the writer waits and the traces pile up in Kafka (visible as *lag* in Grafana); when ClickHouse is back, they are written. You can run several writers, up to the number of partitions (12 by default).

Settings (`values.yaml`, section `broker`):

| Setting | Default | In production |
|---|---|---|
| `broker.replicas` | 1 | 3 |
| `broker.replicationFactor` | 1 | 3 |
| `broker.minInsyncReplicas` | 1 | 2 |
| `broker.partitions` | 12 | the most writers you want in parallel (it can be raised, not lowered) |
| `broker.retentionHours` / `broker.retentionBytesPerPartition` | 48 / 512 MiB | to taste, keeping disks in mind (`storage.kafka.size`, per node) |

With three nodes, one can fail or be updated without losing data or stopping ingestion.

**Use a managed Kafka** (Amazon MSK, Confluent Cloud, Azure Event Hubs with its Kafka endpoint) or another Kafka-compatible broker such as Redpanda: set `broker.external.bootstrapServers` to its addresses, separated by commas. The chart then does not deploy Kafka. Adjust `networkPolicy` (its rules point at the chart's own pods) and, if your broker requires it, authentication in the Collectors.

Scale the stateless parts with `kubectl scale`:

```bash
kubectl -n memtrace scale deployment/ingest deployment/otel-collector --replicas=3
kubectl -n memtrace scale deployment/otel-collector-writer --replicas=4
```

**At-least-once delivery, without duplicates you can see.** To never lose a trace, a retry can write the same one twice (a killed pod, an agent that retries after a timeout). MemTrace stores each span once: copies are folded in the background and every read collapses them, so counts, costs and error rates are not inflated.

**ClickHouse version.** MemTrace runs ClickHouse 24.3. If you point it at your own or a managed ClickHouse (`clickhouse.external.host`), use 24.3 or newer: reading without duplicates is as fast as before there, and several times slower on 23.8.

**Housekeeping.** A job runs every hour (`maintain-otel-traces`) that compacts the days that no longer receive data, which keeps reads fast, and removes the previous traces table seven days after the swap below (`make compact` runs it now).

**Upgrading an installation that already has data.** The release creates a second table for traces and a Job (`dedupe-otel-traces`) swaps it in **without stopping ingestion**: it copies the history, swaps the two tables, and picks up what arrived meanwhile. Check it with `kubectl -n memtrace logs job/dedupe-otel-traces`. The previous table is kept as `otel_traces_pre_dedup` in case you need to go back, and uses disk until you remove it (`make dedupe-cleanup` locally; with Helm, `DROP TABLE memtrace.otel_traces_pre_dedup` once you have checked your data). A very large traces table takes time to copy: do it in a quiet hour.

**Upgrading from a version without Kafka.** The old single Collector kept a queue on a volume (`otel-collector-queue`). Wait until it is empty (the metric `otelcol_exporter_queue_size` was 0), upgrade, and then delete the volume: `kubectl -n memtrace delete pvc otel-collector-queue`.

## Monitoring (Prometheus and Grafana)

An optional add-on that lets you **see** the ingestion pipeline instead of reading logs: how many traces arrive, how many are refused and why, how long they take, whether the Collector can write to ClickHouse, and whether the identity database answers. It is off by default.

```bash
make monitoring       # local cluster: deploys Prometheus and Grafana and opens Grafana
make monitoring-down  # removes them
```

Grafana opens at `http://localhost:3000` (user `admin`, password `memtrace-grafana-dev-only` in a local cluster) with the dashboard **MemTrace · Pipeline de ingesta** already loaded. Prometheus is at `http://localhost:9090`; its **Alerts** page shows which alert rules are firing.

With Helm, turn it on with `--set monitoring.enabled=true`. The chart generates the Grafana admin password the first time and keeps it (read it with `kubectl -n memtrace get secret grafana-admin -o jsonpath='{.data.password}' | base64 -d`); set `secrets.grafana.password` to choose it.

What you get:

| Piece | What it shows |
|---|---|
| Dashboard | Requests per second by status code, latency (p50, p95, p99), refusals by reason, deliveries to the Collector, API key cache, spans per stage (received, published to Kafka, written to ClickHouse), the lag of the writers in Kafka, memory, free disk in ClickHouse |
| Alert rules | A pod that does not answer, no `ingest` replica alive, more than 5 % of requests failing, `ingest` unable to reach Postgres or the Collector, a Collector unable to deliver, no writer reading from Kafka, writers lagging by more than 1,000 messages (or 20,000), no Kafka node visible, ClickHouse below 20 % free disk |

Good to know:

- **Alerts are evaluated and shown, not sent.** Prometheus has no Alertmanager here: to get an email or a Slack message, add one and point it at Prometheus. The alerts of [Alerts and budgets](/platform/alerts) in the app are a different thing: they are about your agents' quality, not about the platform.
- **Grafana is not published by the ingress.** Open it with `kubectl -n memtrace port-forward svc/grafana 3000:3000`. If you publish it, add a network policy that lets your ingress controller reach port 3000.
- **Data is kept 15 days** in a 5 Gi volume for Prometheus and a 1 Gi volume for Grafana (`storage.prometheus.size`, `storage.grafana.size`). They are monitoring data, not part of the backups.
- **Postgres status updates with traffic.** The "Postgres seen from ingest" tile and its alert change when requests arrive, because that is when `ingest` talks to Postgres.

## Check performance (load gate)

Before you trust a cluster with real traffic, or after changing its size, run the load gate. It sends traces the way a real agent does (SDK, then the ingest service, the Collector and ClickHouse), queries the API as a user would, and fails if something is below the bar.

```bash
make load-gate            # against the cluster `kubectl` points to, namespace memtrace
```

It needs `kubectl` access and the Python SDK (`pip install -e sdk/python`). It creates its own test user, organization, experiment and API key directly in Postgres, so it does not need a login and never touches your own data.

| What it measures | How | Default limit |
|---|---|---|
| **Lost spans** | Spans the SDK sent minus spans found in ClickHouse after up to 90 s | 0 |
| **Ingest rate** | A burst of 3,000 spans with no pauses, until every one is stored. It is checked every few seconds, so treat it as a floor, not a precise speed | at least 300 spans/s |
| **Query speed** | p95 of the Overview endpoint over 40 calls | at most 500 ms |
| **Collector memory** | Resident memory of the Collector after the run | at most 600 MB |

The limits live in `load-testing/thresholds.json`. They were set with a wide margin over a laptop run (1,000 to 6,000 spans/s depending on the run, 30-45 ms, 140-170 MB), so they catch a real regression and not a slow machine. Tighten them once you know your cluster's normal numbers, or pass `--thresholds my-limits.json`.

Useful options:

| Option | Use |
|---|---|
| `--agents 100 --rounds 10` | More simulated agents and rounds |
| `--burst-spans 20000` | A bigger burst for the ingest rate |
| `--report result.json` | Save the numbers as JSON |
| `--no-fail` | Only measure, for setting your own limits |
| `--cleanup` | Delete what earlier runs left (their organizations and traces) |

Each run leaves an experiment called `Load gate <id>` and its traces. They show up in the organization list of the test user only, but run `--cleanup` when you are done.

In GitHub, the same check runs every night and on demand (the **Load gate** workflow). It installs MemTrace with the Helm chart on a temporary cluster and keeps the report as an artifact.
