# Operations: backups and restore

How to keep your MemTrace data safe and prove you can get it back. MemTrace keeps traces in ClickHouse and everything else (users, datasets, prompts, evaluations, alerts, audit log) in Postgres, so a backup covers both.

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

Create a Secret called `backup-s3` in the `memtrace` namespace. As soon as it exists, both jobs upload every backup to the bucket as well (AWS S3, MinIO, Cloudflare R2, etc.).

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
