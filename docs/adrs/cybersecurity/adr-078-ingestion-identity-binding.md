# ADR-078: Ingestion Identity Binding

* **Status**: Pending
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Parent**: [ADR-076](adr-076-multi-tenant-security-baseline.md)
* **Related**: [ADR-001](../infra/adr-001-otel-collector-clickhouse.md), [ADR-013](../identity/adr-013-identity-postgres-and-oauth-rbac.md), [ADR-077](adr-077-strict-tenant-isolation-in-clickhouse.md)

## Context and Problem Statement

The ingestion gateway (`api/src/app/api/v1/ingest/v1/traces/route.ts`) checks that the bearer API key is valid and not revoked, then forwards the OTLP body to the Collector untouched. Its own comment records the limitation: the body is protobuf and is not opened, so nothing checks that the `service.name` inside the spans belongs to the experiment of the key.

Consequences today:

- a client with a valid key for experiment A can send spans labelled with the `service.name` of experiment B and write into B's traces (data poisoning, fake errors, fake feedback);
- the tenant of a span is whatever the sender claims, which defeats any isolation built on the read side ([ADR-077](adr-077-strict-tenant-isolation-in-clickhouse.md)).

## Options Considered

| Option | Trust model | Cost |
|---|---|---|
| A. Parse the OTLP payload in the gateway and reject spans whose `service.name` differs from the key's | Gateway verifies | Medium: decode protobuf and JSON, re-encode if rewriting |
| B. Parse and **overwrite** `service.name` and add `memtrace.experiment_id` from the key | Gateway decides, sender cannot lie | Medium: same decoding, plus re-encoding |
| C. Collector extension that maps key → experiment | Collector decides | High: custom build of `otelcol`, key lookup from the Collector |

## Proposed Decision

**Option B.** The gateway is already the only authenticated entry point; it becomes the place where tenant identity is assigned.

1. Decode the OTLP request (protobuf and JSON, gzip included) with the official OTLP definitions.
2. For every resource, set `service.name` to the experiment's `service_name` and add the resource attribute `memtrace.experiment_id` with its UUID, replacing any value sent by the client. A mismatch is logged as a metric (it usually means a misconfigured agent) but does not fail ingestion.
3. Re-encode and forward to the Collector. Enforce a maximum body size and a decompressed-size limit.
4. The Collector exporter writes `memtrace.experiment_id` into the `ExperimentId` column of ClickHouse (ADR-077).
5. The same rule applies to every other write path that accepts an agent key: scores, evaluation uploads, user feedback, prompt drafts. They already resolve the key to an experiment and must use that value, never a value from the body.
6. Direct access to the Collector is removed by [ADR-079](adr-079-network-segmentation-and-collector-access.md); without it this ADR can be bypassed.

## Verification

- Test: send spans with the key of A but `service.name` of B; they are stored under A.
- Test: send an oversized or malformed payload; the gateway answers 4xx without reaching the Collector.
- Test: every write endpoint ignores a client-supplied experiment/service identifier.

## Consequences

- **Positive**: tenant identity of every span is assigned by the platform, not claimed by the sender; fixes the known limitation.
- **Negative**: the gateway now decodes and re-encodes payloads, adding CPU and latency per request; the gateway becomes the ingestion bottleneck and needs its own limits (see rate limiting, P1 in ADR-076).
