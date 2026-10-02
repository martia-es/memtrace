# ADR-032: Automatic Dataset Versioning (Semver) and Per-Item Audit Trail

* **Status**: Accepted — supersedes the manual-versioning part of [ADR-031](adr-031-dataset-versioning.md)
* **Date**: 2026-10-02
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-031 introduced `dataset_versions` so a `dataset_run` stays reproducible as a dataset changes, but made version creation a manual dashboard action ("New version" button, cloning the previous version's items for the user to then edit). Using the real UI surfaced two problems:

1. **Manual versioning is a trap, not a safeguard.** Nothing stops someone from editing items without first clicking "New version" — except there is no such path anymore once versioning is manual-only, so in practice people either forget to version before editing (losing the old snapshot) or the step just feels like unnecessary friction before every edit.
2. **No accountability.** Nothing recorded *who* added or changed a given item, or *when* — only the version's own `created_by`/`created_at`, which says who triggered the version, not who is responsible for which row inside it.

## Decision Outcome

1. **Versioning becomes fully automatic — there is no manual "create version" action anymore.** Every call that mutates items (`addDatasetItems`, `updateDatasetItem`, `deleteDatasetItem`) creates its own new `dataset_versions` row as a side effect, atomically, in the same transaction. The `POST .../versions` endpoint from ADR-031 is removed; `GET .../versions` remains as a read-only changelog.

2. **Semver-style `major`/`minor` replace the flat `version_number`:**
   - **MAJOR** bumps (minor resets to 0) on a **structural** change: adding or removing an item changes what the dataset's item count/shape is, which is exactly the kind of change that makes an old run not directly comparable to a new one.
   - **MINOR** bumps (major unchanged) on editing an existing item's content in place — the dataset still has "the same items", just corrected.

   This distinction is the one piece of manual judgment ADR-031 preserved (the user choosing when to snapshot); automating it still needed a rule, and structural-vs-content change is the only signal available without asking.

3. **Every `dataset_items` row carries `created_by`/`created_at` and `updated_by`/`updated_at`.** When a version is cloned forward (on any mutation), each item's own authorship is preserved as-is except for the one row actually being added, edited, or dropped. This means "who introduced this example" and "who last touched it" survive across versions — not just "who triggered version N".

4. **`dataset_versions.note` is generated automatically** ("Added item", "Edited item", "Deleted item", "Added N items") rather than user-entered, since there is no longer a manual step at which a human would type one.

5. **The dashboard's Items tab always operates on the latest version.** There is no version picker for editing — you edit "the dataset" and the system versions forward for you. The Versions tab becomes a pure read-only history (version, what changed, item count, by whom, when), not a place to create or select a version to work on.

## Consequences

* **Positive**: nobody can forget to version — it isn't a step, it's a side effect. Full accountability per item without any extra UI action. Major/minor gives a cheap, meaningful signal for "is this run comparable to the last one" without the user ever choosing a version number.
* **Negative**: every single item edit, even a one-character typo fix, now clones the entire item set into a new version row + new item rows. For a dataset with many items edited one at a time, this is more writes than batch-editing then versioning once (ADR-031's model). Acceptable given the premise (ADR-028) that datasets are curated and low-volume; revisit if that stops being true.
* **Compatibility**: purely internal/dashboard-facing. The SDK-facing contract from ADR-031 (`GET/POST .../datasets/:id/items`, `POST .../datasets/:id/runs`, versionless from the SDK's point of view) is unchanged — `major`/`minor` replace `version_number` only in the Postgres schema and the dashboard-only version-history/item-management endpoints, which the SDK never calls.

## Follow-up: deletion left no trace (2026-10-02)

The first implementation of point 1 excluded a deleted item from the next version's clone — correct for "current items," but it meant the item itself, and who removed it and when, were gone with no record anywhere; only the version's generic "Deleted item" note hinted that *something* had been removed. This defeated the accountability goal of this very ADR for the one operation (deletion) that destroys information.

**Resolution**: `dataset_items` gained `deleted_by`/`deleted_at`. Deleting an item now clones it into the new version as a tombstone — same `input`/`expected_output`/`metadata` and original `created_by`/`created_at`, plus `deleted_by`/`deleted_at` set — instead of dropping it. `listDatasetItems` (the "current state" view used for editing) filters `deleted_at IS NULL`, so tombstones never show up as editable items and are never re-cloned into later versions (a tombstone lives only in the one version where the deletion happened). A new read-only endpoint, `GET .../datasets/:id/versions/:versionId/items`, returns a version's full item set including its tombstones, so the dashboard's Versions tab can show, per version, what was added/edited/deleted and by whom — closing the gap without changing the SDK-facing contract at all.
