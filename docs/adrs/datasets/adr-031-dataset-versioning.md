# ADR-031: Dataset Versioning and Management UI

* **Status**: Accepted; the manual version-creation model (point 2, "a new version clones...") is superseded by [ADR-032](adr-032-automatic-dataset-versioning-and-item-audit.md), which makes versioning fully automatic. The `dataset_versions` table itself, the major-change-stays-reproducible rationale, and the SDK-compatibility approach (points 1, 3, 6) still stand.
* **Date**: 2026-10-02
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Datasets (ADR-028) are a flat `datasets` 1→N `dataset_items` table. Editing a dataset's items mutates them in place, so a `dataset_run` created yesterday points at data that may no longer exist today — the run is no longer reproducible, and comparing two runs can silently compare different underlying data. There is also no way to manage a dataset (create it, edit its items) from the dashboard: today the only path is the Python SDK uploading data via `run_experiment()`.

We need: (1) a way to change a dataset's items without breaking past runs, and (2) a dashboard UI to create/edit datasets and their items manually. Both touch the same place: how `dataset_items` relates to `datasets`.

Hard constraint: the SDK (`sdk/python/memtrace/adapters/outbound/http/eval_api_client.py`) calls `GET /datasets/:id/items` and `POST /datasets/:id/runs` with a plain `dataset_id`, documented publicly in `docs-site/library/evaluation.md` and `examples/06_evaluate_against_memtrace.py`. This surface cannot change.

## Decision Outcome

1. **`dataset_versions` as an intermediate table, not a `version` column on `dataset_items`.** A version is an immutable snapshot: once created, its items don't change (new items go into the next version, not retroactively into an old one). Modeling it as its own table with its own `id` lets `dataset_runs` and `dataset_items` both point at a specific, frozen version via a normal foreign key, instead of a "valid as of version N" range query.

2. **A new version clones (snapshots) the previous version's items** instead of starting empty. The dashboard's "new version" action is meant for small edits (fix a wrong expected output, add a couple of items), not re-authoring a dataset from scratch — cloning makes that the common case the cheap one.

3. **`submitDatasetRun` resolves "latest version" server-side**, at the moment a run is submitted (`EvaluationService.submitDatasetRun`, `api/src/application/evaluation-service.ts`). The SDK still only ever sends a `dataset_id`; it never learns about versions. This is what keeps the public SDK/API surface unchanged — the versioning concept exists entirely behind the one endpoint the SDK calls, resolved transparently.

4. **The old `datasets/:id/items` route becomes an alias for "items of the latest version"**, kept only for the SDK and backward compatibility. Dashboard-side management (listing/creating versions, editing/deleting individual items of a chosen version) uses new, explicit routes: `datasets/:id/versions`, `datasets/:id/versions/:versionId/items`, `.../items/:itemId`.

5. **`dataset_runs` keeps its direct `dataset_id` column** (denormalized) alongside the new `dataset_version_id`, so runs can still be listed/filtered by dataset without a join through versions — used by the new experiment-wide "Runs" view (see below).

6. **Dashboard navigation splits "Datasets" and "Runs" into two top-level sections.** Previously a single "Evaluation" entry showed datasets, and only inside one dataset could its runs be seen. A run belongs to exactly one dataset (and one version of it), but browsing runs across all datasets without picking one first is a common need (e.g., "what ran most recently, regardless of dataset?") — hence a new `GET /experiments/:id/runs` endpoint (`listRunsForExperiment`) joining `dataset_runs` + `datasets` + `dataset_versions`, backing a dedicated Runs page. Clicking a row still opens the existing per-dataset run detail page/URL — no change to how a single run is fetched.

7. **No new authorization role.** Dataset management mutations (create dataset/version, add/edit/delete item) use the same `canReadExperiment` check that dataset creation already used pre-ADR-031 (any experiment member, not just `admin`) — consistent with how `api-keys` creation already works (ADR-016). Introducing a stricter "who can edit datasets" role is left for a future ADR if it turns out to be needed.

## Consequences

* **Positive**: past runs stay reproducible — a run's `dataset_version_id` never changes even as the dataset evolves. Manual dataset management becomes possible from the dashboard without touching the SDK or its documented contract. The Datasets/Runs nav split matches how users actually think about the two (a dataset is a thing you curate; a run is an event that happened).
* **Negative**: dataset size now grows with `items × versions`, since each version fully clones the previous one's items — acceptable given datasets are explicitly curated/low-volume (ADR-028's own premise), but a dataset edited very frequently with very large items would waste storage. Not optimized for here; revisit if it becomes a real workload.
* **Compatibility**: purely additive at the SDK/public-API level — `dataset_id`-based calls behave exactly as before, now resolved against "latest version" instead of "the only version". Migration (`migrations/postgres/007_dataset_versioning.sql`) backfills every existing dataset with a version 1 containing its current items, so no existing data or run is lost or reassigned.
