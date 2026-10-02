# ADR-001: OpenTelemetry Collector and ClickHouse for Trace Ingestion and Storage

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

MemTrace needs a decoupled, self-hosted ingestion and storage layer for AI agent traces (roadmap pieces 2 and 3). Instrumentation must talk to it through a standard protocol so the storage engine can change without touching agent code.

## Decision Drivers

- Adherence to OpenTelemetry standards (OTLP as the contract of piece 1).
- No custom ingestion service to build and maintain.
- Fast analytical queries (P95 latency, error rate, token usage) over many spans.
- Storage details hidden behind the query API (roadmap architecture rules).

## Considered Options

1. **Custom Python HTTP ingestion API + PostgreSQL**
2. **OpenTelemetry Collector (`otelcol-contrib`) + ClickHouse**
3. **Jaeger (or Zipkin) with its native storage**

## Decision Outcome

Chosen option: **Option 2**.

### Pros and cons

| Option | Pros | Cons |
|---|---|---|
| 1. Custom API + PostgreSQL | Full control; familiar tooling | We must build batching, retries, backpressure, queues; row store is slow for wide aggregations over spans; custom protocol couples clients to us |
| 2. Collector + ClickHouse | OTLP native; batching, retries, memory limiting and persistent queue built in; columnar engine suited to aggregations and high compression of text attributes | Two more components to operate; the ClickHouse exporter schema must be tracked when upgrading the Collector |
| 3. Jaeger / Zipkin | Ready-made UI and trace search | Fixed data model and UI; limited aggregate analytics; Phase 2 (learning from traces) needs raw analytical access; conflicts with our own dashboard (piece 5) |

### Consequences

- **Positive**:
  - Clients depend only on OTLP; the storage engine is invisible to them.
  - Batching, retry and buffering come from configuration, not code.
  - GenAI attributes are stored as-is in `SpanAttributes` (no special engine support is claimed; conventions are defined in ADR-004).
- **Negative / Trade-offs**:
  - Operating a Collector and ClickHouse (memory footprint of roughly 1-3 GB locally; to be measured).
  - Collector version is pinned (`0.96.0`) because the ClickHouse exporter is contrib code whose expected columns can change between versions.
  - Performance claims are hypotheses until measured with real traces.

## Related Decisions

- ADR-002: where and how these components run locally.
- ADR-003: who owns the ClickHouse schema.
- ADR-005: persistence of storage and of the Collector queue.
