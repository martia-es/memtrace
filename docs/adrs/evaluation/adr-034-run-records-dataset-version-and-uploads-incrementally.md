# ADR-034: Runs Always Record Their Dataset Version and Upload Incrementally

* **Status**: Accepted
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-028 made offline evaluation a client-side function (`run_experiment`) with a default HTTP adapter against MemTrace's API; ADR-031/032 made datasets versioned. Reviewing the result exposed three gaps:

1. **The run's version was a race.** The SDK read the items of the dataset's *latest* version, but the API stamped the run with the latest version *at upload time*. If someone edited the dataset while the experiment ran (it can take minutes with an LLM agent or judges), the run was attributed to a version it never read. Reproducibility is the point of versioning, so this is not tolerable.
2. **All results were uploaded at the end.** A crash, Ctrl-C or API outage halfway lost every score already computed (and paid for).
3. **The SDK returned rows but no aggregates.** The pass rate / average per evaluator existed only server-side, so someone using the SDK without MemTrace could not see how a run went.

The SDK must also stay usable without the API: every MemTrace-specific piece has to stay optional.

## Decision Outcome

1. **A run always states its dataset version.**
   - `GET .../datasets/{id}/items` now returns `version: {id, major, minor}` next to the items (the version actually served, even when "latest" was requested). `MemTraceDatasetSource.version` exposes it as `"major.minor"`.
   - `POST .../runs` requires `datasetVersion`; the API no longer guesses "latest". Old behavior (silently stamping the latest version) is removed.
   - `ExperimentResult.dataset_version` records it. Other sources fill it as they can: `LocalFileDatasetSource` uses a content fingerprint (`sha256:<12 hex>`); an in-memory list or a custom source without a `version` attribute leaves it `None`. The optional `version` attribute on `DatasetSource` is the only extension to the port.
   - `MemTraceResultsSink` refuses to open a run (clear `ValueError`, before any agent call) when the version is unknown or isn't `major.minor` — e.g. local data uploaded to a MemTrace dataset — instead of assuming "latest".

2. **Incremental upload.**
   - New optional port `IncrementalResultsSink` (`start` / `add` / `finish`). If a sink implements it, `run_experiment` pushes each item as soon as it finishes, in completion order and tagged with its dataset position (`add(index, item_result)`); otherwise it calls `save()` once at the end exactly as before. `MemTraceResultsSink` implements both (`save` = `start` + `add`* + `finish`).
   - API: `POST .../runs` can open a run with `complete: false` and no items (status `running`); the new `POST .../runs/{runId}/items` appends a batch (`items`, `complete`); every item carries its own `itemIndex`, so batches need not be contiguous or ordered (`startIndex` remains only as a fallback for items without one). Migration `012_dataset_run_status.sql` adds `dataset_runs.status` (`running` | `completed`, existing rows `completed`).
   - Idempotency comes from `scores` being a `ReplacingMergeTree` keyed by `(run, ItemIndex, Name)`: resending an item with the same `itemIndex` overwrites, never duplicates. `item_count` only grows (`GREATEST(item_count, max itemIndex + 1)`): while `running` it is an upper bound, once `completed` it is the total.
   - Failure semantics: `start` failing aborts before the first agent call; a failed batch is kept and resent with the next one; `finish` raises if something is still unsent. Because that happens after the agent already ran, `run_experiment` raises `ResultsUploadError` carrying the full `.result`, so computed results are never thrown away. A crashed process leaves a `running` run with the items uploaded so far. Appending to a `completed` run is a 409.

3. **Local aggregates.** `ExperimentResult.summary()` returns one `ScoreSummary(name, data_type, count, pass_rate, average)` per evaluator with the same semantics as the API's `ScoreAggregate` (boolean → pass rate, numeric → average, categorical → none), plus `error_count`. Pure Python, no MemTrace.

## Consequences

- **Breaking for old SDKs** posting runs: `datasetVersion` is now mandatory. Acceptable at 0.1.0; the SDK and API ship together.
- A decoupling regression test runs `run_experiment(local data, sink=None)` in a process where `httpx` is blocked and asserts the HTTP adapter module is never imported.
- The dashboard does not yet distinguish `running` runs (the field is in the API response); follow-up.
- A crashed run can have gaps (the items that hadn't finished), not just a missing tail; `ExperimentResult.items` still comes back in dataset order.
