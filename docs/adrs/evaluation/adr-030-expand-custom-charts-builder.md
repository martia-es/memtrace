# ADR-030: Expand the custom charts builder (still closed, not a free query builder)

## Status

Accepted. Incremental extension of [ADR-027](adr-027-custom-metrics-on-custom-spans.md).

## Context

ADR-027 shipped a declarative custom-chart builder (chart type + step type(s) + metric + optional filter + optional group-by), deliberately closed to avoid exposing SQL to the user. Using it surfaced two problems:

1. **"Group by attribute" and "filter attribute" are free-text inputs.** The user has to already know the exact attribute key (e.g. `guardrail.blocked`) and type it correctly — there's no discovery endpoint for attribute *keys*, only for an attribute's *values* once you've named it (`GET /attribute-values`). This makes the builder unusable unless you already know your own instrumentation by heart.
2. **The builder only supports one filter at a time** even though the `filters` field was always modeled as an array, and **step types are easy to mistake for an axis** when they're actually a dataset filter — there is no x/y axis concept in the model at all; axes are implied by `chartType`.

The user asked for something closer to Looker/Power BI (free choice of dimensions, measures and axes). That is a separate, larger decision — it would mean replacing the closed enum model with a composable dimension/measure query builder, which changes how piece 4 (query API) validates and executes requests, and deserves its own ADR when it's actually scoped. This ADR only covers the smaller, immediately actionable gap: making the *existing* closed model usable and slightly richer, without opening up arbitrary SQL shape.

## Decision

Stay inside the ADR-027 model (`chartType` / `metric` / `stepTypes` / `filters` / `groupByAttribute` as closed, server-validated fields) and extend it additively:

1. **New discovery endpoint**: `GET /experiments/:id/attribute-keys?stepTypes=...&range=...` — distinct `SpanAttributes` keys seen on the selected step type(s), with counts (`arrayJoin(mapKeys(SpanAttributes))`, same bounded/parameterized pattern as `getAttributeValues`). This powers real `<select>`s for both "group by attribute" and "filter attribute" instead of free text. The user never types an attribute name again; attribute names and values are both discovered live from their own data, like the step types already were.
2. **Multiple filters in the UI** — the data model already allows an array of filters (max 10); the builder now lets the user add/remove filter rows instead of hard-coding one.
3. **Two more metrics**: `p50_duration`, `p95_duration`, alongside the existing `count` / `avg_duration` / `error_rate`. Still a closed, server-computed enum — no user-supplied aggregation expression.
4. **Two more chart types**: `area` (same shape as `line`, filled) and `table` (same shape as `bar`/`pie` — one row per label — rendered as a plain table instead of a chart, useful to just read the numbers).
5. **Explicit axis/series labeling in the UI** — the builder now states in plain text what will be plotted (e.g. "X axis: time, bucketed by 1h · Series: value of `guardrail.check`" or "X axis: step type" when there's no group-by), computed from the current selection, so the relationship between `stepTypes`/`metric`/`groupByAttribute` and the resulting chart stops being implicit.

## Explicitly out of scope here

- **A second group-by level** (crossing two attributes) — the result shape (`points: {label, value}[]`) is flat; a real two-dimensional breakdown needs a nested result shape and is a bigger, separate change.
- **User-chosen numeric measure** (e.g. `sum`/`min`/`max` of an arbitrary attribute value) — today's metrics all operate on fixed fields (`Duration`, `StatusCode`, row count). Letting the user pick *any* attribute as the thing being aggregated is the first real step toward the Looker-style model and needs its own design (validating the attribute is actually numeric, etc.).
- **Free choice of what goes on X vs Y independent of chart type** — chart type still implies the data shape, as in ADR-027.

These three, together, are essentially "ADR-027 v2: a real dimension/measure model" and should be scoped as their own ADR when prioritized, not bolted on here.

## Consequences

- One new read-only ClickHouse query (bounded, parameterized, same pattern as existing discovery endpoints) — no schema change.
- `CustomMetricTypeDto` and `CustomChartTypeDto` grow two variants each; both are additive changes to a closed enum, compatible with existing saved `custom_metrics` rows (no migration needed).
- The builder UI gets meaningfully less confusing without becoming a general query builder, which keeps piece 4's "no user SQL" invariant from ADR-027 intact.
