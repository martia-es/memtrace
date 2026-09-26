# ADR-008: Hexagonal Architecture for the Python SDK

* **Status**: Accepted (restructures the code described in ADR-006/ADR-007; their decisions still hold)
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The first SDK implementation was ported from the LangSmith exporter. `OTELExporter` did everything (config, OTLP transport, in-flight registry, parenting, attribute policy, TTL, flush); decorators imported OpenTelemetry directly next to the exporter; LangChain-specific extraction lived in a shared module; the "never raise" policy was repeated in try/except blocks; disabling was `if not self._otel_available` checks. Adding a framework or transport meant editing the core.

## Decision Outcome

Hexagonal architecture (ports & adapters), applying SOLID without frameworks:

```
memtrace/
  domain/         semconv, StepType/LlmCall/CapturePolicy, attribute building   (pure Python)
  application/    ports.py (SpanPort/SpanHandle) · TracingService (use cases + fail-safe policy)
                  · RunRegistry (run_id → span, TTL) · context (session, current run)
  adapters/
    inbound/      decorators.py · langchain.py         → call TracingService
    outbound/     otel/ (span adapter, exporter factory, sanitizer) · noop.py (Null Object)
  config.py
  dependency_container.py   composition root: picks adapters, builds TracingService
```

1. **Dependency rule**: `domain` imports nothing from the SDK layers or technologies; `application` depends on `domain` and its own ports only; inbound adapters depend on `application`/`domain`, never on outbound adapters or OpenTelemetry. Enforced by `tests/test_architecture.py`.
2. **Outbound port `SpanPort`** ("publish spans") with `start_span / activate / current / flush / shutdown`. `activate`/`current` express the ADR-007 context bridge without leaking OTel concepts. OTel is one adapter; `NoopSpanPort` (Null Object) replaces `enabled` checks; tests use an in-memory fake.
3. **Fail-safe policy lives in `TracingService`** (single `_failsafe` decorator): instrumentation never propagates exceptions to the agent, and `step()` always runs the user's block.
4. **OCP**: new OTLP protocol = register a builder in `exporter_factory`; new framework = new inbound adapter; no core edits.
5. **Composition root** `dependency_container.py` is the only place that chooses concrete adapters and reads `Settings`. It is a plain module with functions, not a DI framework. A process-wide `TracingService` is kept because decorators are a module-level API; adapters accept an explicit `service` where injection is useful (`MemTraceCallbackHandler(service=...)`).
6. Content-capture policy (ADR-004) is injected as `CapturePolicy` at init instead of being read from the environment on every call.

## Consequences

- **Positive**: core testable without OpenTelemetry (`FakeSpanPort`); one place for fail-safe; each file has one reason to change; new frameworks/protocols are additive.
- **Negative**:
  - More files and indirection for a ~1.2k-line SDK; contributors must respect the dependency rule.
  - Swapping OTel itself is unlikely (OTLP is the system contract), so the port pays off mainly in testability and isolation, not in replaceability.
  - Config changes to capture policy need re-initialisation (`shutdown()` + `init_tracer()`).
