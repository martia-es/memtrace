# ADR-007: SDK Span Parenting via the OTel Context (no Deterministic IDs)

* **Status**: Accepted (amends ADR-006 decisions 2 and 3; module layout superseded by ADR-008)
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-006 copied the LangSmith exporter design: derive `trace_id`/`span_id` deterministically from the run UUID. In the implementation those IDs were computed but never applied (the tracer always generated random ones), and nothing bridged `@trace_step`, the LangChain handler and third-party auto-instrumented libraries: each produced a separate trace. LangSmith needs deterministic IDs because it re-exports runs that already exist elsewhere; MemTrace creates spans live in-process, so it does not. ADR-006 also listed attribute names that ADR-004 (accepted) supersedes.

## Decision Outcome

1. **The OpenTelemetry current context is the source of truth for parenting.**
   - `@trace_step` / `trace_step_context` make their span the *current* span (`trace.use_span`).
   - `TracingService.start_run` resolves the parent as: span of `parent_run_id` if still in flight → otherwise the current OTel span → otherwise a new root trace.
   - Result: a LangChain run inside a `@trace_step`, or an httpx/OpenAI auto-instrumented call inside a step, lands in the same trace.
2. **`run_id → span` store is kept only for callback-driven frameworks** (LangChain gives `run_id`/`parent_run_id` but no span handle). TTL cleanup remains (ends orphan spans, flagged `memtrace.span.expired=true`).
3. **Deterministic UUID→ID conversion is removed** (`_otel_utils.py` deleted). `run_id` is a lookup key, not a trace/span ID.
4. **Attributes follow ADR-004**, not ADR-006: `gen_ai.provider.name` (not `gen_ai.system`), `memtrace.step_type` (not `memtrace.span.kind`), `gen_ai.conversation.id` for sessions (standard attribute instead of `memtrace.trace.session_id`), `memtrace.metadata`/`memtrace.tags` for framework metadata.
5. **Every span ending is fail-safe and catches `BaseException`** (asyncio `CancelledError`, `KeyboardInterrupt`), so spans are never leaked until TTL.
6. **Transport is configurable**: OTLP/HTTP (default; gRPC in the extra `grpc`, see the amendment below), headers, batch parameters, public `flush()`.

## Consequences

- **Positive**: one coherent trace per agent run across decorators, LangChain and auto-instrumentation; fewer moving parts; attributes match what the ClickHouse/dashboard side expects.
- **Negative**:
  - The LangChain handler does not make its spans *current* (attaching/detaching a context across async callbacks is unsafe), so auto-instrumented calls made inside a LangChain tool attach to the nearest `@trace_step`, not to the tool span.
  - If LangChain never delivers the parent's callback, the child becomes a child of the current span or a root (fragmented trace).
  - Re-exporting pre-existing runs with fixed IDs (LangSmith-style) would need a custom `IdGenerator`; out of scope for Phase 1.

## Amendment (2026-10-10): OTLP/HTTP is the default transport

The platform's Collector now accepts only OTLP/HTTP behind the ingest gateway (ADR-090), so a gRPC default pointed at `localhost:4317` no longer reaches any MemTrace component. The base install now ships the OTLP/HTTP exporter and `MEMTRACE_OTLP_PROTOCOL` defaults to `http/protobuf`. gRPC stays available for users who send traces to their own collector or another OTLP backend, as the extra `grpc` (`protocol="grpc"`). The `http` extra remains as an empty alias for existing installs. The SDK's trace path is still plain OpenTelemetry: only the defaults changed, not the ability to point it at any OTLP endpoint.
