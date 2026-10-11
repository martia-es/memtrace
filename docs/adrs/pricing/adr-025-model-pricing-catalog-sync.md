# ADR-025: Model Pricing Catalog Synced from LiteLLM, with Arena Quality Scores

* **Status**: Accepted (amended 2026-10-11: quality scores and match decisions, see the last section)
* **Date**: 2026-09-29
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md) (permissions), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md) (audit log), [ADR-088](../cybersecurity/adr-088-strict-tenant-isolation-in-clickhouse.md) (tenant isolation), [ADR-094](../observability/adr-094-in-app-notification-feed.md) (the bell)

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

---

## Amendment (2026-10-11): Quality Scores from Arena and Per-Organization Match Decisions

### Context

The model pricing page answers "what does a model cost" but not "is it any good". A second public source, the Arena leaderboard (`lmarena-ai/leaderboard-dataset` on Hugging Face), publishes an Elo score per model from human preference votes. Showing it next to the price lets someone compare cost with quality.

The Arena dataset **has no prices, no context window and no API model id**. It cannot replace LiteLLM; it is a second source, joined to it by model name. The join is the hard part. Measured on 2026-10-11 against the Arena text leaderboard (category `overall`, 414 models) and the LiteLLM chat models:

| Name relation | Models | Share |
|---|---|---|
| Same name once lowercased and stripped of the provider prefix | 179 | 43 % |
| Same name only after dropping an effort or mode suffix (`-high`, `(thinking-minimal)`, `-32k`) or a release date | 71 | 17 % |
| No counterpart in LiteLLM (new, regional or Arena-only models) | 164 | 40 % |

A suffix is not cosmetic: `claude-opus-4-7` is 1483 and `claude-opus-4-7-high` is 1490, and `claude-sonnet-4-5-20250929` is 1439 against 1435 for its `-high-32k` run. Picking one silently shows a wrong number. Arena also publishes new models all the time (33 in the last 12 publications, about four a week), so any mapping decays.

### Decision

1. **A second sync worker, `analytics/model_quality`.** Same shape as `model_pricing` (own package, Dockerfile and daily `CronJob`), kept separate because the source, its failure modes and its licence differ. It lists the dataset folder through the Hugging Face tree API, takes the `text/latest-*.parquet` file, checks that the expected columns exist and upserts into ClickHouse. If the file is missing, the schema changed or the download fails, **the previous rows are kept**: no data is better than an empty overwrite, and a failed run is visible as an old `UpdatedAt`. The file is read with `pyarrow` only (no `datasets` library, no pickle): it is third-party data and is treated as untrusted text and numbers, with length limits on names.
2. **Storage of the scores: `memtrace.model_quality`** (ClickHouse, `ReplacingMergeTree(UpdatedAt)`), keyed by `(Source, Arena, ModelName)`, holding the latest snapshot only: `Organization`, `License`, `Rating`, `RatingLower`, `RatingUpper`, `VoteCount`, `Rank`, `PublishedAt`. `Source` (`arena`) and `Arena` (`text`) are columns, not constants, so a second source (Artificial Analysis) or another arena (`webdev`) is more rows, not a new table. The first version syncs only `text` / `overall`. The data is public, so the table has no tenant column, like `model_pricing`.
3. **Matching is computed on read, not stored.** Both catalogs are small (about 4,000 and 400 rows). The API derives a **model key** from every name (lowercase, provider prefix and vendor dots removed, as in `azure/gpt-5.2` and `bedrock/anthropic.claude-opus-4-7`) and applies two levels:
   * **Exact**: the keys are equal. It is shown with no question asked. All pricing rows with the same key share the match, so a provider-prefixed copy never needs a decision of its own.
   * **Candidate**: the keys are equal after both sides drop effort and mode suffixes, size tags and release dates. Nothing is shown until a person confirms; the candidates are listed closest name first.
   Anything else is simply unmatched. No fuzzy or similarity matching: a wrong silent match is worse than an empty cell. The functions are pure, live in `api/src/domain/` next to `pricing.ts`, and are tested against the real names above.
4. **Only human decisions are stored**, in Postgres (they are edited by people, need a transaction and an audit trail, and the identity store already owns that): `model_quality_matches (organization_id, model_key, arena_model_name, decision, decided_by, decided_at)`, with `decision` one of `confirmed`, `rejected` or `no_equivalent`. At most one `confirmed` row per organization and key. A decision survives every sync; a `rejected` pair is never offered again; `no_equivalent` silences the model until it is cleared. If a confirmed Arena model later disappears from the leaderboard, the cell keeps its last known score and is marked as no longer ranked.
5. **Decisions belong to the organization.** The catalogs are global and public, but a decision changes what people see, so letting one organization decide for the whole installation would let it alter another's page. This is the same reason as ADR-088. Exact matches need no decision and are shared by everyone.
6. **A new permission, `pricing:manage`**, held by `technical` (experiment scope), like `alert:manage`. It is not an `org_admin` permission: `org_admin` reads no trace data (ADR-052) and "which models does the agent use" comes from traces. The permission is checked on an experiment, but the decision is stored for that experiment's organization (point 5). Reading the page and the scores needs only `experiment:read`. Every decision is written to the audit log of ADR-084 (`model_match.update`).
7. **The bell shows pending decisions as live state, like firing alerts (ADR-094), not as events.** A model is *pending* when it has candidates, no decision, and appears as `gen_ai.request.model` in the last 30 days of an experiment where the person holds `pricing:manage`. "In use" is matched on the name without suffixes and dates, so a trace that says `gpt-5.2-2025-12-11` counts as `gpt-5.2`. The in-use query runs over 30 days of spans and the bell asks every minute, so the API remembers its answer for five minutes per set of experiments. There is no notification table and no unread mark: the item is there until someone decides, then it disappears. Models nobody uses never notify; they only appear under the **Needs review** filter. Only people with `pricing:manage` see the item. It is not sent by email: unlike an alert, a missing quality score costs nothing while it waits.
8. **API.** `GET /api/v1/model-pricing` does not change: it is global and anonymous to the organization, and the quality depends on one. The quality is a separate read, per experiment so that the tenant scope and the permission come from it: `GET /experiments/{id}/model-quality` (`experiment:read`) returns the source, licence and snapshot dates and, for each model with something to show, `state` (`matched | candidate | none | no_equivalent`), `inUse`, the score (`elo`, ±interval, `rank`, `votes`, `origin`, `stale`), the nearest candidate and `via`. `GET .../model-quality/candidates?scope=in_use|all`, `PUT` and `DELETE .../model-quality/matches/{modelKey}` need `pricing:manage`. `GET /model-quality/pending` serves the bell and covers the agents where the person holds that permission. The page joins both reads by `modelId`.
9. **Attribution is part of the feature.** The dataset is CC BY 4.0: the page names Arena, links it and shows the date of the snapshot, and the user docs repeat the licence. The page also says what the number is: human preference in chat, not accuracy on the user's task.

### Alternatives considered

| Option | Why not |
|---|---|
| Replace LiteLLM with Arena | Arena has no prices or context window; cost per trace would stop working. |
| Fully automatic fuzzy matching | 17 % of names differ by a suffix that changes the score. A silent wrong number is worse than an empty cell. |
| Store the automatic matches in a table | They go stale at every sync and add a write path from the worker to Postgres for data that can be derived in microseconds. |
| One global mapping for the installation | One organization could change what another sees. Rejected on tenant grounds (ADR-088). |
| Ship an alias file in the repository | Releases are slower than Arena (about four new models a week) and an alias file cannot know a customer's own deployment names. It may come later as a seed under the organization decisions. |
| Artificial Analysis or OpenRouter benchmarks as the source | Both need an API key (Artificial Analysis also asks for attribution and caps the free tier at 1,000 requests a day), tying every installation to an account. The `Source` column leaves the door open as a second source. |
| Notify for every new unmatched Arena model | Four a week, most for models nobody here uses; people would learn to ignore the bell. |

### Consequences

* **Positive**: a quality column with no key, account or cost; decisions that cannot be undone by a sync; nothing for a person to do until a model they actually use needs it; one catalog of public data and a small table of private decisions.
* **Negative**:
  * Elo measures preference in chat. It says little about tool use, long documents or a specific domain; the page must not be read as a ranking of agents.
  * About 40 % of Arena models will never match LiteLLM, and the share of *your* models that do is unknown until measured on real traces. The first release should log how many in-use models are exact, candidate and unmatched.
  * Arena can rename its files or columns. The worker fails closed and keeps the last data, but the scores can go stale without a person noticing; the page shows the snapshot date.
  * `model_key` is a second normalisation next to the exact lookup in `costOf()` (see "Negative" in the original decision). They should share the same function, but changing how cost is looked up is not decided here and is tracked in the backlog.
  * Decisions are per organization, so two organizations confirm the same pair twice.
* **Measured on the implementation (2026-10-11)**: of 2,892 priced chat models in LiteLLM, which collapse to 1,377 distinct keys once provider copies are merged, 204 match exactly, 182 have candidates and 991 have nothing in Arena. The 991 are mostly old, regional or niche models; what matters is the share of models a person *uses*, which the first release should log.
* **Not covered**: other arenas (`webdev`, vision, agents), history and trend charts of a model's Elo, "cost per quality point", and email delivery of pending matches.
