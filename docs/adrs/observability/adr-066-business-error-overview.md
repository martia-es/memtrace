# ADR-066: Business-Language Error Overview Without AI

* **Status**: Accepted — implemented
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-057](../ui/adr-057-business-vocabulary-for-custom-charts.md), [ADR-062](adr-062-end-user-feedback-on-traces.md)

## Context and Problem Statement

Business profiles can read conversations and charts, but a failed tool call, an exhausted provider quota or a 5xx only make sense in a trace, which is a technical view. The Overview said "4% of executions failed" without saying why. We want a business-readable account of **what is failing and how bad it is**, without using an LLM: it must be deterministic, explainable and free to run.

## Decision Outcome

### 1. An ordered rule catalogue maps the technical signal to a business cause

`api/src/domain/error-categories.ts`. The signal of a failed span is `kind` (tool / llm / custom step), `StatusMessage` and `exception.type`; an explicit HTTP status is extracted from the message (`status 503`, `429 Too Many Requests`; a bare number such as "500 items" is ignored). The first matching rule wins, so order is priority (quota before any 4xx, timeout before 5xx). Each category carries a title, a plain explanation, a suggested action and a severity (high / medium / low). The text matched is the status message plus `exception.message` and `exception.type`, because some SDK paths (for example pydantic-ai tool retries) leave the status message empty and only the exception carries the cause. Unmatched errors fall into `other_tool` / `other_model` / `other`, which tells the technical team which rule is missing.

Rules are code, not data, for now: they are reviewed, tested and versioned with the product. Making them editable per organisation is a follow-up and would only replace the source of the catalogue.

### 2. Classification happens in the query API, not in the SDK or at ingestion

* **Not the SDK.** Every client would need to upgrade to get a new rule, and past traces would stay unclassified.
* **Not at ingestion** (materialised column). It would fix the catalogue at write time and force a backfill on every rule change. Revisit if error volume makes the query slow.
* **In `TraceQueryService`.** The port `TraceRepository.listErrorGroups` returns failed spans grouped by `(kind, name, message, exception type)` (SQL stays in the adapter); the domain classifies and merges the groups. A rule change takes effect immediately on all retained data.

### 3. Only the deepest failing span is counted

A failing tool makes its parent step and the root span fail too. Counting them all would triple-count one incident, so the query keeps failing spans that have no failing child (`(TraceId, SpanId) NOT IN (parents of failing spans)`). Totals (traces and conversations with errors) are computed separately and exactly; per-category traces/conversations are sums of group counts capped at those totals, because a conversation hit by two different messages of the same category is counted twice otherwise.

### 4. Trend compares with the previous period of equal length

`GET /api/v1/experiments/:id/errors/overview?from=&to=&service=` runs the query for the range and for the range immediately before. If the previous period is older than the 30-day retention, it is skipped and `previousRange` is `null`; the dashboard then shows no trend instead of marking everything as "new".

### 5. Visibility

The endpoint needs experiment read access, like `metrics/overview`, so business profiles can use it. It exposes normalised messages (digits and ids replaced), never span inputs or outputs.

## Consequences

* Business users get causes, impact, trend and who to ask, in the Overview, without opening a trace.
* The catalogue is English text in the API; the dashboard is English-only today. Localisation would move titles to the dashboard keyed by `id`.
* Out of scope for now: distinguishing errors the agent recovered from (retry / fallback) from those that broke the answer, alert thresholds, per-organisation editable rules, and filtering the conversation list by cause (the "View failed conversations" link lists all failed ones).
