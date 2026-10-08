# ADR-069: Evidence per Prompt Version

* **Status**: Accepted — implemented (2026-10-08)
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md), [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md)
* **Related**: [ADR-025](../pricing/adr-025-model-pricing-catalog-sync.md), [ADR-060](../evaluation/adr-060-per-evaluator-pass-rate-target.md), [ADR-062](../observability/adr-062-end-user-feedback-on-traces.md), [ADR-066](../observability/adr-066-business-error-overview.md)

## Context and Problem Statement

Every prompt tool shows the text of a version. MemTrace can show what the version **did**: ADR-068 stamps each trace with the prompt version it used, and traces, user feedback and offline evaluation already live in ClickHouse. This ADR turns that into a per-version report, and into a comparison that says whether v4 is better than v3.

## Decision Outcome

### The unit of evidence is the trace

A version's evidence is computed over **the traces that have some span stamped with `(prompt, version)`** in the range, for the agent that is asking. All other spans of those traces count too (the tool that failed, the other LLM calls): the prompt is one decision inside a trace, and its effect shows in the trace's outcome. A trace that used two versions counts in both (documented in the UI); that is rare and the alternative, splitting a trace between versions, has no meaningful answer for latency or errors.

### What is measured

| Figure | How |
|---|---|
| Traces, conversations | distinct, among the stamped traces |
| Error rate | traces with **any** failed span ÷ traces (not only a failed root: an agent often answers after a tool fails) |
| Latency p50 / p95 | duration of the root span of those traces |
| Cost per trace | tokens of the `chat` spans of those traces × the pricing catalog (ADR-025). If a model has no price the cost is a **minimum** and flagged (`costComplete: false`); if none has, it is unknown, never `$0` |
| Failures by cause | deepest failed spans only (ADR-066), classified into business categories with the existing `summarizeErrors`; the top 3 per version |
| User 👍 | current votes (`FINAL`, `IsDeleted = 0`) on those traces; satisfaction = 👍 ÷ votes |
| Evaluators | offline evaluation items whose `trace_id` is one of those traces, aggregated per evaluator: pass rate (boolean), mean (numeric), item count (categorical) |

### Offline evaluation reaches the version through the traces

There is **no prompt column on a run** (ADR-068). An evaluation item carries the id of the trace the agent produced, and that trace carries the stamp, so the evaluator results of a version are the join item → trace → stamp. For this to work, the agent must run in the process that calls `run_experiment` with the prompt read through `memtrace.prompts`; otherwise the items have no stamped trace and the version simply shows no evaluator results.

### A read model that crosses tables

`ClickHousePromptEvidenceRepository` joins `otel_traces`, `user_feedback`, `eval_items` and `eval_scores` in ClickHouse in five queries (traces, tokens, failures, feedback, evaluators). The alternative — fetch the trace ids and ask each repository — has to cap the number of traces and silently falsifies the figures once a version has more. The price is that this adapter knows four tables; it is read-only and isolated. The cost and the business causes are applied in the domain (`buildPromptEvidence`), so the adapter stays free of pricing and rules.

Queries are validated against **ClickHouse 23.8**, the version of the cluster. They avoid CTEs in joins and use `USING (TraceId)`.

### API and permissions

`GET /experiments/{experimentId}/prompts/{promptId}/evidence?from=&to=` → `{ range, versions[] }`, only the versions with traffic, newest first. Default range 24 h, maximum 30 days (the retention). It requires `experiment:read` **and** `prompt:read`: these are the agent's data, so an `org_admin`, who reads no data (ADR-052), does not get them through the prompt permission. The prompt must belong to the agent (404 otherwise). Feedback and evaluation scores outlive the trace retention, but the version is found through its traces, so the evidence is bounded by it.

### Comparing two versions (dashboard)

The Compare tab shows, above the text diff, the figures of the two versions side by side with their change, labelled *Better / Worse / No change* by the direction of each metric (less error, latency and cost is better; more 👍 and pass rate is better). Rules:

- A movement under **5 %** (or under 0.5 points for rates) is "No change": it is not worth reading.
- **Sample size is part of the answer.** Below 30 traces a version is marked *few traces*, and a comparison where either side is below it carries a warning that the differences may be chance. MemTrace does not do significance tests yet; the threshold is a guardrail, not a proof.
- Only evaluators both versions have are compared; categorical ones are not.
- A version without traffic in the period says so instead of showing zeros.

### Not in this phase

Human annotations (they need the score-config range to decide what is "low"), a per-version time series, and cohort controls (the versions of one prompt may have served different agents or traffic mixes, so a difference can come from the traffic and not from the text). The promotion gate (next phase) will use these figures with explicit thresholds.

## Consequences

- **Good**: every version carries its measured quality, cost and failures; the comparison answers "is it better?" with honesty about sample size; nothing is stored twice.
- **Cost**: five aggregation queries per request over the stamped traces of the range (limited by the shared query limiter); fine for the 30-day retention, to be revisited with a rollup table if prompts get very high traffic.
- **Risk**: confounding. If v4 went to production on Monday and v3 ran in a quiet week, the figures are not comparable; the dashboard shows the observed period but cannot control for it.

## Alternatives considered

- **Store metrics per version at write time** (a counters table): fast reads, but frozen definitions and a second source of truth; recomputing from traces lets the definitions improve.
- **Attribute only the stamped span** (the LLM call) instead of the trace: exact for latency and tokens of that call, but blind to the tool failing after it, which is usually what a prompt change causes.
- **Do the joins in the API**: unbounded id lists and more round trips (see above).
