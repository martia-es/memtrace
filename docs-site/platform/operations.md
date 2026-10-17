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
