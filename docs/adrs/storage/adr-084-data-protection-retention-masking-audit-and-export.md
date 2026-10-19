# ADR-084: Data Protection — Retention, PII Masking, Audit Log and Export

* **Status**: Accepted. Amended 2026-10-19 by [ADR-102](../governance/adr-102-agent-risk-classification.md): retention is set per risk level, not per organization or experiment
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-021](../sdk/adr-021-sdk-explicit-tracer-provider-and-content-redaction.md), [ADR-045](../README.md#retired-adrs), [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)

## Context and Problem Statement

Traces contain prompts and answers, so they contain whatever the users of an agent typed. Four gaps stopped MemTrace from being adopted by a company that has to answer to a data protection officer (items F4 and F7 of `docs/backlog.md`):

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

`GET /experiments/{id}/export?kind=traces|annotations|feedback|scores&from&to` streams newline-delimited JSON from ClickHouse, limited to 31 days per call. It needs permission `data:export`, which goes to the `technical` role and not to `org_admin`: `org_admin` manages people and settings but by design reads no data (ADR-052), and an export is reading data. It is recorded before the first byte is sent and goes through the existing query limiter. One `kind` per call keeps the files composable and the memory flat. A `dryRun=1` variant validates and counts without recording anything, so the screen can explain a bad range or an oversized export before the browser starts a download that it cannot recover from; the download itself is a plain streamed response, never buffered in memory. Above 2,000,000 records the request is refused and the range must be narrowed.

### Amendment (2026-10-19): retention per risk level

*Problem.* Log retention is a legal requirement that depends on how risky the agent is (EU AI Act, arts. 12 and 26.6: at least six months for high-risk systems), yet it was configured in two other places, the organization default and a per-experiment override that could only shorten it. Anyone with `retention:manage` could set a period below the legal floor, and an agent nobody had classified was purged after 30 days.

*Decision.* Retention is managed in **one place**, the organization's risk policy (ADR-102), as one period per risk level (`unclassified`, `minimal`, `limited`, `high`). The retention of an agent is the period of its level (`unclassified` while it has none). What stays as decided above: the daily job, the `retention_worker` user, the 365-day ceiling (the ClickHouse TTL), the scope (spans and topics) and `retention:manage`.

- **Floor in the domain, not only in the UI.** `high` and `unclassified` cannot be below 180 days (`AI_ACT_MIN_RETENTION_DAYS`); the API answers 422 with the reason. Above the floor the organization chooses freely, up to 365. `unclassified` has the same floor because an agent that is purged before anybody classifies it as high-risk loses records that cannot be recovered.
- **Removed.** The organization default and the experiment override are no longer configurable, in the UI or in the API; Data protection links to the risk policy. `effectiveRetentionDays(org, override)` becomes `retentionDaysFor(level, policy)`; the purge targets and the Errors-page lookup read the same function.
- **Migration.** `risk_policies` is seeded per organization: `minimal` and `limited` with the current organization period, `high` and `unclassified` with `max(current, 180)`. Overrides are dropped, so an agent that had a shorter one now follows its level and keeps its traces longer; each one is written to the audit log (`retention.update`, actor: system, with the old override) so the change can be traced. The two old columns stay unused for one release and are dropped afterwards.
- **Lowering a period deletes data.** The next nightly purge applies it and what it deletes cannot be recovered. Lowering a level's period asks for confirmation and shows how many agents and how many spans it affects. Reclassifying an agent to a lower level has the same effect and the classification dialog says so.
- **Not an absolute rule.** Art. 26.6 allows other Union or national law (the GDPR) to provide otherwise, which is why the policy has a floor and no minimum for the other levels, and why the legal review of the numbers stays outside MemTrace.

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
* **Update (M8):** the query API cap (`MAX_RANGE_MS`) is now 365 days, the same as the retention ceiling, and the dashboard offers 90 d and 1 y presets and custom ranges up to a year. The Errors page compares with the previous period only when that period starts inside the agent's effective retention (the longest one if several organizations share a `service.name`; looked up in PostgreSQL with a 60-second cache, falling back to 365 days if the lookup fails). Lookups by id (a conversation or transcript) now search the last 365 days instead of 30: they rely on the partition pruning of the time filter and the `ConversationId` bloom index, and have not been benchmarked on a year of real data (only the unit and integration suites ran), so watch their latency on large installations.
* Two organizations may use the same `service.name`; their traces cannot be separated in storage, so the **longest** of the periods applies (a wrong deletion is irreversible, a late one is not). **Superseded by [ADR-088](../cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md)**: spans now carry `ExperimentId` and the purge filters by `ServiceName` and `ExperimentId`, so each experiment keeps its own period.
* The ingest gateway now checks that the `service.name` of every span belongs to the API key used ([ADR-085](../identity/adr-085-ingest-gateway-validates-service-name.md)), which is what makes retention and audit per experiment trustworthy.
