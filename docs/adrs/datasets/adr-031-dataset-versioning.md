# ADR-031: Dataset Versioning — Immutable Snapshots, Semver, Stable Item Identity and Publish per Session

* **Status**: Accepted. Consolidates the former ADR-031, 032, 033, 038 and 041 (see [the ADR index](../README.md))
* **Date**: 2026-10-02 (consolidated 2026-10-10)
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Datasets (ADR-028) started as a flat `datasets` 1→N `dataset_items` table. Editing items mutated them in place, so a `dataset_run` created yesterday pointed at data that may no longer exist today: the run was not reproducible and comparing two runs could silently compare different data. Datasets also needed to be managed from the dashboard, not only from the SDK. The public SDK/API surface (`GET /datasets/:id/items`, `POST /datasets/:id/runs`, documented in `docs-site/library/evaluation.md`) could not change.

## Decision Outcome

1. **Versions are immutable snapshots in their own table.** `dataset_versions` has its own `id`; `dataset_items` and `dataset_runs` point at a frozen version through a normal foreign key. A mutation clones the previous version's items into a new version. `dataset_runs` also keeps a denormalized `dataset_id` so runs can be listed per experiment without a join.
2. **Versioning is automatic, never a manual step.** Every mutation creates its version atomically in the same transaction. The version carries semver-style `major.minor`: **MAJOR** on a structural change (item added or removed, so old and new runs are not directly comparable), **MINOR** when only the content of existing items is edited. `note` is generated ("Added 3 · Edited 2 · Removed 1").
3. **Per-item audit.** Items carry `created_by/at`, `updated_by/at` and `deleted_by/at`. Deleting clones the item into the new version as a **tombstone** (never re-cloned afterwards), so who removed what survives.
4. **Stable identity and server-side diff.** `dataset_items.origin_item_id` is the id the item was born with, copied on every clone. A pure domain function (`domain/dataset-diff.ts`) pairs items by it and compares `input`, `expectedOutput` and `metadata` by deep equality; audit columns never count. Any version can be diffed against any other (`GET .../versions/:versionId/diff?against=`); `GET .../versions` returns real added/modified/removed counts.
5. **The SDK stays versionless by default.** Without a version the server resolves "latest" when the run is submitted. The SDK can pin `major.minor` (`run_experiment(..., dataset_version="2.1")`); the `major.minor` string is the public handle (`domain/dataset-version.ts`). A run always records the exact version it read: the API requires `datasetVersion` on `POST .../runs` and never guesses "latest", and the SDK refuses to open a run when the version is unknown.
6. **One published session = one version.** The Items tab is an inline-editable grid whose edits live in a client-side draft until **Publish**, which calls `POST /datasets/{id}/changes` with `{ add[], update[], remove[] }`. The server applies it in a single transaction (dataset row locked with `FOR UPDATE`) and creates one version; if someone else published first and ids are stale, nothing is written and the draft stays in the browser. The per-item `PUT`/`DELETE` endpoints remain for API users (one version each).
7. **Promotion from traces reuses all of the above.** `POST .../items/from-traces` (max 100 traces per call) builds items from annotated traces and calls the same add path **once**, so one call = one MAJOR. The item is self-contained: the input is copied (and editable), the agent's real answer goes to `metadata.observedOutput` and **never** silently to `expected_output`. Expected output resolves in this order: explicit `expectedOutput` > observed output if the person asked for it (`useObservedOutput`) > the label of a chosen categorical annotation config > `null`. Traces without captured content are skipped (`no_content`) and a trace already promoted is skipped (`already_promoted`). Provenance is stored in `promotedFrom`.
8. **Authorization.** No new role: dataset mutations use `canReadExperiment` (any experiment member), as before versioning.

## Considered Alternatives

* **A `version` column on `dataset_items`.** Rejected: runs would need a "valid as of version N" range query instead of a foreign key.
* **Manual "New version" button.** Tried first; people forgot to version before editing, or it was friction before every edit.
* **Server-side drafts, debounced auto-publish, CSV/JSONL import as main path.** Rejected for now: drafts add schema and conflict states for a low-volume, usually single-editor workflow; auto-merging versions makes boundaries unpredictable; the product direction is that the grid must be as good as a spreadsheet.

## Consequences

* **Positive**: past runs stay reproducible; change counts and diffs are true; an editing session is one meaningful version; the SDK contract is unchanged.
* **Negative**: dataset size grows with `items × versions` (each version clones the previous). Diffing loads all items of the compared versions in memory. Both are acceptable while datasets are curated and low-volume (ADR-028's premise); revisit with SQL-side diffing or deduplicated storage otherwise.
* **Negative**: unpublished edits live only in the browser tab (guarded by an unload warning). Concurrent editors can force a "reload and retry".
* **Migration**: `007_dataset_versioning.sql` backfilled a version 1 per dataset; `011_dataset_item_origin.sql` backfilled `origin_item_id` heuristically (matching clones by dataset, `created_by` and `created_at`), so old versions may pair a sibling wrongly. New data does not depend on it.
