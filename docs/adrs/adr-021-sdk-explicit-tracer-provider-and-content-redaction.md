# ADR-021: SDK Hands Its Tracer Provider to Auto-Instrumentors and Redacts Captured Content

* **Status**: Accepted (amends ADR-004 and ADR-007)
* **Date**: 2026-09-28
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

An audit of the Python SDK found two design gaps:

1. `enable_pydantic_ai_instrumentation()` and `enable_langchain_instrumentation()` only switched the frameworks' instrumentation on. Both emit spans to the **process-global** OpenTelemetry provider, but `init_tracer()` builds a private `TracerProvider` and never registers it. Result: with the automatic integrations, zero spans reached the collector (reproduced with in-memory exporters).
2. Both auto-instrumentations record prompts and completions by default, bypassing the opt-in content policy of ADR-004. In addition, ADR-004's capture was all-or-nothing: enabling it for production meant exporting API keys or tokens that appear in tool arguments.

## Decision Outcome

1. **Do not set a global provider.** Registering ours globally would clash with an application's own OpenTelemetry setup. Instead, `SpanPort` exposes an opaque `tracer_provider` (None for the no-op port) and inbound adapters pass it explicitly to the framework (`InstrumentationSettings(tracer_provider=…)` for Pydantic AI, `instrument(tracer_provider=…)` for LangChain). The application layer stays free of OpenTelemetry types.
2. **That provider is a process-wide `SwitchableTracerProvider`** whose target `init_tracer` / `shutdown` move. The LangChain instrumentor binds to a provider only once and cannot be re-bound; with a stable object in between, re-initializing (notebooks, tests, hot reload) keeps working, and spans emitted while there is no target are dropped silently.
3. **Content follows the ADR-004 policy everywhere**: `include_content` (Pydantic AI) and `TRACELOOP_TRACE_CONTENT` (LangChain, only if the user did not set it) are derived from `MEMTRACE_CAPTURE_CONTENT`.
4. **One choke point for redaction: a `SanitizingSpanExporter`** wraps the real exporter, so it covers every span whatever created it (decorators, LangChain handler, Pydantic AI, any auto-instrumented library), and every string that leaves the process: attributes, event attributes (exceptions), status message, `trace_llm_call(attributes=…)`, LangChain metadata. Detection is by **key** (fragments such as `api_key`, `password`, `authorization`, `secret`; deliberately not `token`, to keep `max_tokens`; extendable with `MEMTRACE_REDACT_KEYS`) and by **value shape** (`sk-…`, AWS/GitHub/Google/Slack keys, JWT, `Bearer …`, private key blocks, `user:pass@` URLs, `password=…` pairs). Redaction is on even with capture off. An optional `init_tracer(redact=callable)` hook covers what has no fixed shape (emails, names); it fails closed, and a span that cannot be sanitized is exported without attributes or events.
5. **The same exporter fills `memtrace.step_type`** on spans that lack it, from `gen_ai.operation.name` (or Traceloop's span kind). The query API only classified `chat` and `execute_tool` by operation, so an auto-instrumented `invoke_agent` showed as `unknown`.
6. **`SessionSpanProcessor`** stamps the active `session()` id on spans from third-party instrumentation, overriding any id the library generated; spans from MemTrace's own tracer keep their explicit attributes.
7. **Capture-time bounds**: payloads are pruned (depth, item count, string length) before serialization, and `MEMTRACE_MAX_ACTIVE_RUNS` plus a daemon reaper bound in-flight spans.

## Consequences

- **Positive**: the automatic integrations actually export; secrets are masked on every path with one mechanism; no interference with the host application's OpenTelemetry configuration; re-initialization works.
- **Negative**:
  - Personal data (PII) is not detected by default. It is opt-in through the optional `pii` extra (`memtrace.pii.presidio_redactor`, built on the `redact` hook), so the core keeps depending on OpenTelemetry only. Only ClickHouse receives trace content; PostgreSQL stores identity data and never sees it.
  - Detection is heuristic: a secret with no known shape, under an innocuous key, inside free text, is not caught (use the hook). A key like `secretary` is masked (substring match).
  - Sanitizing copies each span (`ReadableSpan`) and runs regexes over string attributes; the cost is small next to the network export but not zero. It happens in the batch export thread, off the request path.
  - Dropped-attribute counters of the original span are not carried over.
