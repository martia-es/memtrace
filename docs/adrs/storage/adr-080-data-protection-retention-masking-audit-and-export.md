# ADR-080: Data Protection — Retention, PII Masking, Audit Log and Export

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-021](../sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md), [ADR-045](../evaluation/adr-045-evaluation-follow-ups-retrieval-metrics-summaries-retention-and-writer-user.md), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)

## Context and Problem Statement

Traces contain prompts and answers, so they contain whatever the users of an agent typed. Four gaps stopped MemTrace from being adopted by a company that has to answer to a data protection officer (items F4 and F7 of `docs/phase-1-improvement-plan.md`):

1. **Personal data reaches the database.** The SDK can anonymize (ADR-021, Presidio) but only if the agent turns it on. The platform had no net of its own.
2. **Retention is a hard-coded 30 days** in the ClickHouse TTL of every trace table. It cannot differ per organization or per agent, and it cannot be longer.
3. **Nobody can say who looked at what.** There is no record of reads of conversation content, of access changes or of configuration changes.
4. **Nobody can take their data out** in a machine-readable form.

## Decision Outcome

### 1. PII is masked with `****`, before it is written

The requirement is that personal data never reaches the server or the database, so every control acts before the write. Three layers, strongest first:

| Layer | Where | Covers |
|---|---|---|
| No content (`MEMTRACE_CAPTURE_CONTENT=false`, already the default) | Agent | Everything |
| SDK anonymization (Presidio, opt-in) | Agent, before export | Everything it recognizes, **including names** |
| Collector `transform/pii` (new, always on) | Platform, before the ClickHouse exporter | Fixed-format data from every agent: email, card, IBAN, DNI/NIE, SSN, phone, IPv4 |

The mask is the same fixed `****` everywhere (secrets in the SDK, Presidio, the Collector), whatever the type or length of the data: a mask that keeps the length or the type leaks information. Names and free text have no fixed format; a regular expression cannot find them and running Presidio in the write path would mean parsing OTLP in Python on every batch. That limit is documented, not hidden. Patterns are RE2 in the Collector ConfigMap, and `scripts/check_collector_pii.py` tests them (including against the real Collector binary) so a bad pattern cannot ship silently.

*Consequence of the mask change*: the old `[REDACTED]` and `<PERSON>` strings are gone from new data. The SDK changelog says so.

### 2. Retention: organization default, experiment override, enforced by a daily job

* PostgreSQL stores `organizations.trace_retention_days` (default 30) and `experiments.trace_retention_days` (nullable override). The effective value is `min(override, organization)`; an override longer than the organization default is refused. Range 1–365 days.
* ClickHouse TTL is per table, not per tenant. The TTL of `otel_traces`, `otel_traces_trace_id_ts` and `span_topics` becomes the **ceiling** (365 days). A daily CronJob (`purge-traces`) deletes, per experiment (`ServiceName`), the rows older than its effective value. Nothing changes for existing installations: the default stays 30 days.
* The job uses its own ClickHouse user, `retention_worker`, with `SELECT` and `ALTER DELETE` on only those tables (same idea as `api_writer` in ADR-045). The API user still cannot delete.
* Scope: spans and derived topics. Scores, annotations and end-user feedback are not traces and keep their own lifecycle (feedback must outlive trace retention, ADR-062).
* Changing a retention is permission `retention:manage` (organization role `org_admin`) and is written to the audit log; so is every purge.

### 3. Audit log in PostgreSQL

* Table `audit_log`: when, organization, experiment, actor (id plus an email snapshot, so the entry survives deleting the user), action, target and a small JSON `metadata`. It is **append-only by construction**: the application has no update or delete path, and a purge job removes entries older than 365 days.
* What is recorded: opening the **content** of a trace or conversation (detail, transcript), data exports, retention changes and purges, member and API key changes. List and metric views are not recorded: they carry no content and would bury the useful entries.
* Reading the log is permission `audit:read` (`org_admin`). It never records the content it refers to, only identifiers.
* Writing an audit entry must not break the request that caused it for reads of content, but it **does** block data exports: an export that cannot be recorded does not happen.

### 4. Export as streamed JSONL

`GET /experiments/{id}/export?kind=traces|annotations|feedback|scores&from&to` streams newline-delimited JSON from ClickHouse, limited to 31 days per call. It needs permission `data:export`, which goes to the `technical` role and not to `org_admin`: `org_admin` manages people and settings but by design reads no data (ADR-052), and an export is reading data. It is recorded before the first byte is sent and goes through the existing query limiter. One `kind` per call keeps the files composable and the memory flat.

## Considered Options

* **Presidio inside the Collector or an ingest proxy.** Would catch names, but puts a Python NER model on the hot write path and ties ingestion to its latency. Rejected; the SDK layer covers names where the data is created.
* **Scan and report PII after storing it.** Rejected: the requirement is that it never lands.
* **One TTL per organization through ClickHouse.** Not expressible in a table-level TTL without a per-row column filled at ingestion, which the Collector cannot do. A column would also make every retention change a rewrite of existing data.
* **Audit log in ClickHouse.** Rejected: low volume, needs integrity and a join with users, which is what PostgreSQL is for (ADR-013).
* **Per-organization retention only.** Rejected: an agent with sensitive data needs a shorter period than the rest.

## Consequences

* Easier: answering a data protection review (what is masked, how long it is kept, who accessed it, how to export it).
* Harder: patterns in the Collector have false positives and negatives; they live in one ConfigMap and a test. A 9-digit phone number with no separators is not masked on purpose, to avoid hitting ordinary numbers.
* Costs: a longer ceiling TTL allows more data on disk if someone raises retention; the default does not.
* Limits: the ingest gateway does not check that the `service.name` of a span belongs to the API key used (ADR-013). Retention and audit are per experiment by `ServiceName`, so closing that hole is a follow-up (F9 in the plan).
