# ADR-077: Editable Data Catalog for Custom Charts

* **Status**: Accepted — all three phases implemented (editable names, automatic classification, numeric metrics)
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-027](../evaluation/adr-027-custom-metrics-on-custom-spans.md), [ADR-030](../evaluation/adr-030-expand-custom-charts-builder.md), [ADR-057](adr-057-business-vocabulary-for-custom-charts.md)
* **Related**: [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md)

## Context and Problem Statement

ADR-057 made the Custom charts builder usable by business profiles, but every name still comes from the code: a fixed dictionary for the built-in steps and attributes, or an automatic humanization of the identifier (`input_guardrail` → "Input guardrail"). A business person cannot fix a name that the developer chose badly, cannot tell a useful attribute from an id or a free text, and can only measure counts, durations and failure rates. ADR-057 explicitly planned a server-side catalog "auto-discovered per experiment and editable from the dashboard" and rejected asking developers to label things in the SDK (easy to forget).

## Decision Outcome

Three phases, one branch and one pull request each. They share one idea: **discovery stays live, only the human decisions are stored**.

### Phase 1 — Editable names (this change)

**What is stored: edits only.** `chart_catalog_entries(experiment_id, kind, key, display_name, visibility, updated_by, updated_at)` in PostgreSQL (migration 039). `kind` is `step` or `attribute`; `key` is the technical key (`memtrace.step_type` value or attribute key). What exists in the traces is still discovered on demand from ClickHouse (`getStepKinds`, `getAttributeKeys`), so there is no sync job and nothing to keep consistent. A row exists only if it says something: a database `CHECK` refuses a row with no name and `auto` visibility, and going back to automatic **deletes** the row.

**The key never changes.** Saved charts and reports store technical keys (ADR-027/035), so renaming breaks nothing and a rename reaches every chart already saved.

**Name cascade**: edited name → built-in dictionary → humanized identifier. The vocabulary functions (`stepLabel`, `attributeLabel` and everything built on them) take an optional `names` argument; with none they behave exactly as in ADR-057. The UI keeps consuming names only through the vocabulary module, so no component changed its logic.

**Rules**: a name is 1–80 characters, whitespace collapsed, no control characters; two entries of the same kind in one experiment cannot share a name (case-insensitive), because two options with the same label are indistinguishable in a selector; at most 500 edits per experiment.

**`visibility`** (`auto` / `shown` / `hidden`) is stored from the start so phase 2 needed no new migration; phase 1 accepted it through the API and phase 2 gave it a screen.

**Authorization**: reading the catalog needs `experiment:read` (every chart uses the names); editing needs the new permission `catalog:manage`, granted by the built-in `technical` and `business` roles. Both profiles know the domain and a name is shared by the experiment, so it is deliberately not limited to technical people. As roles are data (ADR-052) an organization can grant or remove it without a code change. `org_admin` and `governance` do not read data and do not get it.

**API**: `GET /experiments/{id}/chart-catalog`, `PUT` (kind, key, displayName, visibility; answers `entry: null` when it returns to automatic) and `DELETE ?kind=&key=`. Key and kind travel in the body or the query string, not the path, because a key can contain dots and slashes.

**Screen**: a "Rename things" button in Custom charts opens an editor listing the steps and attributes detected in the current range plus anything renamed earlier that has no activity now (so it can always be undone). The automatic name is the placeholder; emptying the field resets it.

### Phase 2 — Automatic classification (implemented)

**Statistics, computed where the data is.** `getAttributeKeys` measures each key in one ClickHouse query over the chosen steps and range: spans carrying it, non-empty values, distinct values (`uniqIf`, approximate on purpose: enough to classify and cheaper than `uniqExact`), values that are finite numbers (`isFinite(toFloat64OrNull(value))`, so `nan` and `inf` are not numbers), average length and values shaped like an id. Cost stays bounded by the range, the existing 200-key limit and the query limiter.

**A pure function decides.** `classifyAttribute` (domain, no I/O) returns `kind` (`category`, `number`, `id`, `text`, `technical`), `numeric` and `hiddenByDefault`. Rules in order, all thresholds in one file:

| Order | Rule | Kind |
|---|---|---|
| 1 | The key is instrumentation plumbing (`memtrace.*`, `otel.*`, `gen_ai.usage.*`, `exception.*`…) | `technical` |
| 2 | The key is named like an id (`customer_id`, `user.uuid`, `customerId`) | `id` |
| 3 | At least 80 % of values look like an id: uuid, hex of 24+ characters or a number of 12+ digits (long words are not ids) | `id` |
| 4 | At least 95 % of values are numbers | `category` if 20 distinct values or fewer (a rating), else `number` |
| 5 | Average length above 60 characters | `text` |
| 6 | 20+ values and at least 80 % of them different | `id` |
| 7 | More than 200 distinct values | `id` |
| 8 | Anything else | `category` |

`id`, `text` and `technical` are hidden by default; `category` and `number` stay visible. `numeric` is independent of `kind`, so phase 3 can offer a rating as a measure even though it is also a category. Numbers are deliberately **not** hidden: they were selectable before and hiding them would be a regression until phase 3 gives them their own picker.

**The person has the last word.** The effective rule is `shown` → show, `hidden` → hide, `auto` → follow `hiddenByDefault` (`isAttributeShown`). The builder shows anything already chosen in the chart even if it is hidden, and "Show N more details" reveals the rest. The catalog editor shows each attribute's kind, how many different values it has, why it is hidden and a selector (Automatic / Always show / Always hide); resetting a name keeps a forced visibility, which is undone with its own selector.

**API.** `attribute-keys` items gain `kind`, `distinct`, `numeric` and `hiddenByDefault` (additive). The dashboard falls back to the old name pattern when an older API does not send them.

### Phase 3 — Numeric metrics on attributes (implemented)

**The definition gains one optional field.** `CustomMetricDefinition.metricAttribute` names the numeric attribute that four new metrics measure: `sum_attribute`, `avg_attribute`, `min_attribute` and `max_attribute` (total, average, lowest, highest). The enum stays **closed** and chosen by the server (ADR-027): the person picks an operation and an attribute, never an expression.

**Safe by construction.** The attribute travels as the bound parameter `{metricAttr:String}`, never concatenated into SQL, and the aggregation is `toFloat64OrNull(SpanAttributes[{metricAttr:String}])` with `isFinite(...)` in the `WHERE`, so only spans whose value is a finite number take part: text, `nan`, `inf`, empty values and spans without the attribute are ignored instead of failing or polluting the result. Grouping, filters and time series work as for the other metrics. The existing metrics are untouched (no new parameter, no new filter), and `count` still counts every span.

**Validation says what it measures.** The zod body requires `metricAttribute` for the four new metrics and **forbids** it for the rest (`superRefine`, on the definition, the query and the save body), so a stored chart can never say one thing and measure another. The repository also refuses a metric over a number without an attribute before asking ClickHouse. The server does not check that the attribute is numeric: classification costs a query and a non-numeric attribute simply yields no points; the builder only offers numeric ones.

**Backward compatible.** Charts saved before this change have no `metricAttribute`; they validate (default `null`) and read back as `null` (`toCustomMetricDefinitionDto`). No migration: the definition is JSON.

**Which attributes can be measured** (`isMeasure`, dashboard): the server marked it `numeric` and it is not an `id` — adding up identifiers means nothing. Technical numbers such as token counts **can** be measured even though they are hidden from the group-by selector, and a rating (a category that is also numeric) can too. Measures need a single step, as grouping does (the list of numbers belongs to one step); choosing a second step or a step without that number goes back to counting.

**The builder.** "Measured as…" lists the four new operations only when the step has numbers; choosing one shows "Of which number?" and proposes the first so the chart computes without an extra step. The name and description use the number ("Total of order total in tool calls"), the table header names it ("Average order total"), the value is a plain number with up to two decimals and no unit, and a figure going up is neither good nor bad (only times and failures are judged).

**A bug found on the way, fixed here.** The report email summarized a time series by **adding the buckets** of each series, which is right for counts and totals but wrong for rates and averages (a 5 % daily failure rate became 35 % over a week). `summarizeSeries` now combines by metric: counts and totals add, minimum and maximum take the lowest and highest, and averages, percentiles and rates average the buckets. This changes the figures of existing emails for averages, percentiles and rates, for the better.

## Consequences

- **Good**: business profiles can name things in their own language without a developer and without an SDK change; renames apply retroactively to every saved chart and report; no sync to maintain; deleting an experiment deletes its edits.
- **Cost**: one more table and permission; names are per experiment, not per organization, so the same step in two agents is renamed twice.
- **Risk**: a rename changes what a saved chart says, which is the point, but a chart someone shared as a screenshot will no longer match. Names carry no history in phase 1 (`updated_by` and `updated_at` only).

## Not in phase 1

An organization-wide catalog, per-name translations and a change history. Phase 2 does not classify steps (they are few and named), does not learn from corrections and does not use AI. Phase 3 has no units or currencies (a number is a number), no percentiles over an attribute and no measures that combine several attributes.

## Alternatives considered

- **Labels in the SDK** (rejected in ADR-057): developers forget them and the names would be fixed at deploy time.
- **Storing every discovered key in PostgreSQL**: needs a sync job and goes stale; storing only edits gives the same result with nothing to synchronize.
- **Renaming by rewriting saved definitions**: would change the technical key inside every chart and report; keeping the key and resolving the name at display time is reversible.
- **Catalog edits for technical profiles only**: simpler to reason about, but it leaves business people dependent on a technical one, which is the problem this ADR exists to remove.
