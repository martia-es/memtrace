# ADR-026: Custom step trees via manual instrumentation

## Status

Accepted

## Context

The SDK auto-instruments LLM calls with the OpenTelemetry Gen AI Semantic Conventions (`gen_ai.*`). But an agent's logic is not only LLM calls: a LangGraph node like an input guardrail can run several non-generative steps in sequence (a regex check, a rules-based toxicity classifier, a length check...), none of which are an LLM call. Users need to trace each of these steps as its own span, nested under the node that runs them, so the dashboard shows the full breakdown and reports can be built on top (e.g. "which guardrail step blocks most often").

The question is whether this requires new SDK surface, new attributes, or changes to the storage schema / query API.

## Decision

No new mechanism is introduced. The existing manual instrumentation primitives already satisfy this:

- `trace_step` (decorator) and `trace_step_context` (context manager), in `sdk/python/memtrace/adapters/inbound/manual/step.py`, open a span that becomes the *current* span for the duration of the block. Any span opened inside it — another manual step, an LLM call, or a span from an auto-instrumented library — becomes its child. Nesting is therefore arbitrary and comes for free from normal Python nesting (blocks or function calls), with no extra wiring.
- `step_type` (`memtrace.domain.model.StepType`) is a convenience enum, not a closed set: `step_type_value()` accepts any string. A step that isn't an LLM call, a tool, a retriever, etc. can use a free-form value (e.g. `"guardrail.regex_pii"`).
- Arbitrary extra attributes can be attached via the `attributes` argument, stored under the `memtrace.*` namespace (`domain/semconv.py`) when there's no applicable `gen_ai.*` attribute.
- Downstream, span hierarchy is reconstructed purely from `parentSpanId` (`api/src/domain/tree.ts`, `buildSpanTree`), with no special-casing by span kind or step type. ClickHouse's schema stores spans generically; a custom step type needs no migration.

**Convention for custom step names**: use a dotted namespace scoped to the use case, e.g. `guardrail.regex_pii`, `guardrail.toxicity_rules`, so spans group visually in the dashboard and stay distinguishable from the built-in `StepType` values.

## Consequences

- No SDK, API, or ClickHouse schema change was needed to support this; it's a documentation and example gap, not a code gap (see `docs-site/library/tracing.md` and `examples/03_langchain_agent_manual.py`).
- `gen_ai.operation.name` is left unset for spans using a free-form `step_type` (only the built-in `StepType` values map to a Gen AI operation, see `OPERATION_BY_STEP_TYPE` in `domain/attributes.py`). This is intentional: a custom step is not a Gen AI operation, and forcing one would misrepresent it. The dashboard falls back to `memtrace.step_type` to categorize these spans.
- Because nesting depth and step naming are entirely up to the caller, there's no validation that prevents deeply nested or inconsistently named trees. This is accepted as the same tradeoff already made for `trace_step`/`trace_step_context` in general (ADR-006).
