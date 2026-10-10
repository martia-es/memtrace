# ADR-025: Model Pricing Catalog Synced from LiteLLM

* **Status**: Accepted
* **Date**: 2026-09-29
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

`otel_traces` only stores token counts (`gen_ai.usage.input_tokens` / `output_tokens` / `total_tokens`), never a cost in currency (documented gap, [ADR-023](../README.md#retired-adrs)). Converting tokens to cost requires a per-model price table, and that table needs to stay current as providers change prices and ship new models — maintaining it by hand does not scale.

## Decision Drivers

* No external API key or paid service just to know prices.
* Must stay current without manual edits every time a new model ships.
* Keep the write path simple: a catalog is reference data, not a trace — it must not touch `otel_traces` (owned only by the Collector exporter, ADR-003).

## Decision Outcome

1. **Source**: LiteLLM's public `model_prices_and_context_window.json` (https://github.com/BerriAI/litellm), a community-maintained JSON with input/output price-per-token for thousands of models across providers. It is the de-facto standard other LLM observability tools (Langfuse, Helicone) already use for this same purpose. No auth, no rate limits, no paid tier.
2. **New component**: `analytics/model_pricing`, a standalone Python worker (same shape as `analytics/topic_extraction`, ADR-022) that downloads the JSON and upserts it into ClickHouse. It does not interpret or correct prices — it mirrors the source.
3. **Storage**: new table `memtrace.model_pricing` (migration `004_model_pricing.sql`), `ReplacingMergeTree(UpdatedAt)` keyed by `ModelId`, so a re-sync overwrites a model's price without duplicate rows. No TTL — this is a catalog, not a trace; the entire point is to always have the current price on hand.
4. **Scheduling**: Kubernetes `CronJob` (`k8s/81-model-pricing-sync.yaml`), daily — prices don't change often enough to justify a tighter interval.
5. **Read path**: like every other query, consumed through `TraceRepository` (roadmap piece 4) once the cost-per-trace/cost-per-tool feature is built on top of it — not part of this ADR's scope.

## Consequences

* **Positive**: always-current pricing without maintaining a hand-written table; no new paid dependency; reuses the existing worker pattern (own package, own Dockerfile, own CronJob) instead of inventing a new deployment shape.
* **Negative**:
  * `ModelId` in the LiteLLM catalog doesn't always match `gen_ai.request.model` verbatim (aliases, provider prefixes). Joining `otel_traces` to `model_pricing` to compute real cost will need a normalization step — deferred to whichever ADR introduces the actual cost-per-trace/cost-per-tool query.
  * LiteLLM's JSON is community-maintained, not an official price feed from each provider — it can lag a price change or contain an error. Acceptable for cost *estimates* in a dashboard; not meant as a billing source of truth.
  * `ReplacingMergeTree` dedup happens asynchronously at merge time; any consumer must query with `FINAL` or `argMax(...)`, not read the table as-is.
