# ADR-004: GenAI Semantic Conventions and Opt-in Content Capture

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The first draft used attribute names that OpenTelemetry has since deprecated (`gen_ai.system`, `gen_ai.prompt`, `gen_ai.completion`) and always stored prompts and completions in clear text, which is a privacy risk. The GenAI conventions are still evolving, so the exact names must be verified against the pinned spec version.

## Decision Outcome

1. Span attributes set by `memtrace` follow the current OpenTelemetry GenAI conventions:
   - `gen_ai.operation.name` (e.g. `chat`)
   - `gen_ai.provider.name` (replaces `gen_ai.system`)
   - `gen_ai.request.model`
   - `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
   - `gen_ai.input.messages`, `gen_ai.output.messages` (JSON-serialized message lists; replace `gen_ai.prompt` / `gen_ai.completion`)
2. Framework-specific data uses the `memtrace.*` prefix only when no standard attribute exists (currently `memtrace.step_type`).
3. **Content capture is opt-in**: message content is recorded only when `MEMTRACE_CAPTURE_CONTENT=true`. Default is `false`; metadata (model, tokens, timing) is always recorded.
4. Attributes are stored in ClickHouse `SpanAttributes` as strings (ADR-003).

## Consequences

- **Positive**: compatibility with third-party GenAI instrumentation; safer default for sensitive prompts.
- **Negative**:
  - The dashboard shows no prompts unless content capture is enabled; onboarding docs and examples must say so.
  - Message lists are JSON strings inside a Map value, so they are not queryable by field without JSON functions.
  - Spec names may change again; the semconv version is reviewed when upgrading the SDK. Redaction hooks are out of scope for Phase 1.
