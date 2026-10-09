# ADR-077: Editable Data Catalog for Custom Charts

* **Status**: Accepted — phase 1 (editable names) implemented; phases 2 and 3 designed, not built yet
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

**`visibility`** (`auto` / `shown` / `hidden`) is stored from the start so phase 2 needs no new migration; phase 1 accepts it through the API but its screen only edits names.

**Authorization**: reading the catalog needs `experiment:read` (every chart uses the names); editing needs the new permission `catalog:manage`, granted by the built-in `technical` and `business` roles. Both profiles know the domain and a name is shared by the experiment, so it is deliberately not limited to technical people. As roles are data (ADR-052) an organization can grant or remove it without a code change. `org_admin` and `governance` do not read data and do not get it.

**API**: `GET /experiments/{id}/chart-catalog`, `PUT` (kind, key, displayName, visibility; answers `entry: null` when it returns to automatic) and `DELETE ?kind=&key=`. Key and kind travel in the body or the query string, not the path, because a key can contain dots and slashes.

**Screen**: a "Rename things" button in Custom charts opens an editor listing the steps and attributes detected in the current range plus anything renamed earlier that has no activity now (so it can always be undone). The automatic name is the placeholder; emptying the field resets it.

### Phase 2 — Automatic classification (designed)

A pure function `classifyAttribute` turns statistics computed in ClickHouse for a (steps, range) pair — distinct count, share of numeric values, average length, share that looks like an id — into `category`, `number`, `id`, `text` or `technical` (the existing name pattern). Ids, free text and technical keys are hidden from the group-by and filter selectors by default; `visibility` lets a person force `shown` or `hidden`. Deterministic rules, no AI; the thresholds live in one place and the cost is bounded by the range, the 200-key limit and the existing query limiter. `attribute-keys` gains `kind`, `distinct` and `numeric` fields (additive, backward compatible).

### Phase 3 — Numeric metrics on attributes (designed)

`CustomMetricDefinition` gains an optional `metricAttribute` and the closed metric enum gains `sum`, `avg` and `max` over a numeric attribute. The query remains declarative: the metric is an enum chosen by the server and the attribute is always a bound parameter, never concatenated into SQL (the rule of ADR-027). Only attributes classified as numbers are offered. Saved definitions without the field keep working.

## Consequences

- **Good**: business profiles can name things in their own language without a developer and without an SDK change; renames apply retroactively to every saved chart and report; no sync to maintain; deleting an experiment deletes its edits.
- **Cost**: one more table and permission; names are per experiment, not per organization, so the same step in two agents is renamed twice.
- **Risk**: a rename changes what a saved chart says, which is the point, but a chart someone shared as a screenshot will no longer match. Names carry no history in phase 1 (`updated_by` and `updated_at` only).

## Not in phase 1

Showing or hiding from the screen (phase 2), classification (phase 2), numeric metrics (phase 3), an organization-wide catalog, per-name translations and a change history.

## Alternatives considered

- **Labels in the SDK** (rejected in ADR-057): developers forget them and the names would be fixed at deploy time.
- **Storing every discovered key in PostgreSQL**: needs a sync job and goes stale; storing only edits gives the same result with nothing to synchronize.
- **Renaming by rewriting saved definitions**: would change the technical key inside every chart and report; keeping the key and resolving the name at display time is reversible.
- **Catalog edits for technical profiles only**: simpler to reason about, but it leaves business people dependent on a technical one, which is the problem this ADR exists to remove.
