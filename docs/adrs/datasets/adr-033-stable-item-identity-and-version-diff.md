# ADR-033: Stable Item Identity and Server-Side Version Diff

* **Status**: Accepted — refines point 5 of [ADR-032](adr-032-automatic-dataset-versioning-and-item-audit.md)
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-032 made every item mutation clone the whole item set into a new `dataset_versions` row, with new `dataset_items` rows. The Versions tab then derived "Added / Edited / Deleted" for each item from its own audit columns (`updated_by`, `deleted_by`). Using it showed the result was wrong:

1. **False change counts.** A clone keeps `created_by`, so every unedited item looked "Added" in every version; an item edited once looked "Edited" forever. Each version appeared to change the whole dataset.
2. **No way to compare versions.** Cloned rows have fresh ids, so nothing says "this row in v1.3 is that row in v1.1". Without identity there is no diff, only per-row audit.

## Decision Outcome

1. **`dataset_items.origin_item_id` is the item's stable identity.** It is the `id` of the row the item was born with, copied verbatim on every clone (add, edit, delete tombstone). A new item gets `origin_item_id = id`. Migration `011_dataset_item_origin.sql` adds the column, backfills existing rows best-effort (matching clones by dataset + `created_by` + `created_at`, tie-broken by position inside a batch) and makes it `NOT NULL`.

2. **The diff is computed server-side, in a pure domain function** (`domain/dataset-diff.ts`), pairing items by `origin_item_id` and comparing `input`, `expectedOutput` and `metadata` by deep equality. Audit columns never count as a change. Result kinds: `added`, `modified`, `removed`, plus a count of unchanged items. Tombstones are ignored as state and only used to attribute who removed an item.

3. **Any version can be compared with any other**, not only the adjacent one: `GET .../versions/:versionId/diff?against=:otherVersionId`; without `against` it uses the previous version, and for the initial version everything is "added".

4. **`GET .../versions` now returns real counts** (`addedCount`, `modifiedCount`, `removedCount`) against the previous version, computed from a single query over all items of the dataset rather than one query per version.

5. **The Versions tab is a flat table** (no expandable rows). An info button opens a modal with what changed, who, and a side-by-side git-style diff, with a **Compare with** selector listing earlier versions. This replaces the per-item "Added/Edited/Deleted" derivation of ADR-032 point 5.

6. **The diff endpoint is dashboard-only** (session-authenticated, read-only).

7. **The SDK can pin a version by `major.minor`.** `GET .../items?version=2.1` reads that version's active items, and `POST .../runs` accepts an optional `datasetVersion` so the run is recorded against it instead of the latest. Both default to the latest version, so existing callers are unchanged. The SDK exposes it as `run_experiment(..., dataset_version="2.1")`; the `major.minor` string (not the internal version id) is the public handle, validated in `domain/dataset-version.ts`. Reproducing a previous run therefore no longer depends on nobody editing the dataset in between.

## Consequences

* **Positive**: change counts are true; comparing non-adjacent versions works; the diff logic is unit-testable without a database or UI.
* **Negative**: the backfill is a heuristic. Items added in one batch share `created_at`, so if one of them had its `input` edited before this migration, it may be paired with the wrong sibling in old versions. New data does not depend on it.
* **Cost**: diffing loads all items of the dataset's versions into memory. Acceptable under the premise of ADR-028/ADR-032 (small, curated datasets); revisit with SQL-side diffing if datasets grow.
