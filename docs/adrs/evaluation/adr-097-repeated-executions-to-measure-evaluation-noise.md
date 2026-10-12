# ADR-097: Repeated Executions of a Run to Measure Evaluation Noise

* **Status**: Accepted
* **Date**: 2026-10-12
* **Deciders**: MemTrace Core Team
* **Relates to**: [ADR-028](adr-028-offline-evaluation-decoupled-sdk.md), [ADR-044](adr-044-eval-items-and-scores-tables-telemetry-from-traces.md), [ADR-095](../sdk/adr-095-multi-language-sdk-contract.md), backlog item M4 ([docs/backlog.md](../../backlog.md))

## Context and Problem Statement

*Compare runs* shows, per evaluator, `B − A` of two aggregates (a pass rate, or a mean). The number carries no indication of how much of it is chance. An agent and an LLM judge are not deterministic, so running the **same** code on the **same** dataset twice can give 70 % and 75 %; the screen would paint that as a green improvement. The consequence is a wrong decision (keep a worse prompt, drop a better one) and, for the PR gate (ADR-064), an inability to compare against `main` without false alarms (backlog F5).

The noise of an evaluation depends on the dataset, the agent and the judge, so it has to be **measured** under those conditions, not assumed. Measuring it needs the same agent run more than once under identical conditions. Two constraints shape where that can happen:

* The experiment runner lives in the user's process (ADR-028): MemTrace has no backend that executes anything, so the dashboard cannot launch a run.
* "Identical conditions" means same code revision, same dataset version, same judge, same moment. A repetition started later from a screen depends on the user choosing the right baseline; one started in the same call cannot get it wrong.

## Decision

### 1. Repetitions are a parameter of `run_experiment`

```python
run_experiment(..., repeats=1)   # default: one execution, same cost as today
run_experiment(..., repeats=3)   # three executions of the same run, under identical conditions
```

* `repeats` is an integer from 1 to 10; the default of 1 changes nothing for existing users and costs nothing extra. Measuring noise is opt-in and the user decides how much to spend.
* The executions run one after another inside the same call, with the same `task`, evaluators, dataset version and code revision. Each one uploads its items as today (ADR-034).
* The parameter is part of the public SDK contract: Python and TypeScript both implement it and the shared conformance scenarios cover it (ADR-095).
* The dashboard never launches executions. It only reads and compares.

### 2. A run becomes a group of executions; each execution stays a `dataset_run`

The smallest change to the data model is to keep every execution as an ordinary `dataset_run` and group them:

* `dataset_runs` gains `run_group_id UUID NULL` and `repeat_index INT NULL` (Postgres migration). A run with `repeats=1` has both `NULL`: nothing changes for it. With `repeats>1`, all executions share one `run_group_id` and are numbered 1..N.
* **No ClickHouse change.** `eval_items`, `eval_scores` and `eval_run_summaries` keep their keys: each execution has its own `DatasetRunId`, so every existing query, the telemetry join and the per-item views keep working per execution.
* In the UI vocabulary the user sees a **run** (the group, with the name they gave it) made of **N executions**. Internally the code keeps `dataset_run` for one execution.
* The runs list shows one row per group; the group's aggregate is the mean of its executions, with the spread next to it (section 3).

### 3. Noise and the verdict

For each (dataset version, evaluator, judge) in a group of N ≥ 2 executions:

* **Noise (σ)**: the standard deviation of the per-execution aggregates (pass rate or mean). With N = 2 it is `|a₁ − a₂| / √2`.
* **Item instability**: the share of items whose result differs between executions (boolean) or whose score moves by more than a tolerance (numeric). It points at the cases that make the evaluation unreliable.
* **Verdict on a delta `B − A`**: the standard error of a difference between groups of `nA` and `nB` executions is `σ · √(1/nA + 1/nB)`. The delta is **above noise** when `|B − A|` exceeds twice that value (about 95 %), otherwise **within noise**.
* σ is taken from the group that has repetitions. It is only reused when dataset version and judge (ADR-043) match; otherwise the verdict is **not measured**, the delta is shown as today, and the screen says how to measure it (`repeats=3`). MemTrace never invents a verdict without a basis.
* With fewer than 3 executions the screen labels σ as a rough estimate.

### 4. Two ways to compare in the dashboard

* **Across runs (A)**: *Compare runs* keeps its deltas and adds the verdict next to each: *above noise*, *within noise* or *not measured*.
* **Within a run (B)**: a *Variability* view of one run: per evaluator, the result of each execution, the spread, and the items that change between executions.

### 5. Out of scope

* Launching executions from the dashboard or from CI.
* Making the PR gate depend on the verdict (compare against `main`, backlog F5): this ADR provides the number; changing the gate's contract is its own decision.
* Statistical tests beyond the rule of section 3, and parallel execution of repetitions.

### Update (step 1, SDK and storage implemented)

* `repeats` is in `run_experiment` (Python) and `runExperiment` (TypeScript). The dataset is read once and the executions run sequentially in one call; `repeats` outside 1-10 is rejected.
* The return type depends on `repeats`: `ExperimentResult` for 1, `RepeatedExperimentResult` (`executions`, `summary()` with `values`, `mean`, `noise`) for 2-10. In TypeScript the overloads follow the literal value of `repeats`.
* The API accepts `runGroup: {id, index, total}` when a run is opened (migration `049_run_group.sql`: `run_group_id`, `repeat_index`, `repeat_total`, with a check that all three are set or none, and a unique index on (group, index)) and returns it on every run summary.
* A custom Python `IncrementalResultsSink` that does not accept `repeat=` in `start()` is refused up front when `repeats > 1`. TypeScript cannot inspect a destructured parameter, so a sink that ignores `repeat` simply does not group the executions.
* The shared conformance scenario `eval-run-repeat.json` pins the request both SDKs send.
* Not yet done: the dashboard grouping, the noise and the verdict (step 2).

### Update (step 2, noise and verdict in the dashboard)

* **The statistics live in the API** (`domain/evaluation-noise.ts`, pure and unit-tested), so the dashboard only renders and the PR gate can reuse it later. `EvaluationNoiseService` reads the executions of a run's group and computes two things, exposed as `GET /experiments/{id}/runs/{runId}/variability` and `GET /experiments/{id}/runs/noise?baseline=&candidate=`.
* **Only completed executions count**: one that is still uploading would give a half aggregate. A group with executions missing reports `completed < total`.
* **Noise is combined when both sides were repeated**: pooled by degrees of freedom, `σ² = Σ(n−1)σᵢ² / Σ(n−1)`. A single execution has no noise of its own and borrows the other side's, which is why a repeated baseline is enough to judge a one-off candidate.
* **Numeric item instability** uses a tolerance: a score is unstable when its executions spread by more than 10 % of the largest absolute value seen for that evaluator. Booleans are unstable when they are not all equal.
* **Lists show a group as one row** (`ui/run-groups.ts`): the first execution, with the mean of the finished ones, `× N` and *running* until all `repeats` are in. Compare runs and the run view receive that row; the API resolves the whole group from any of its ids.
* A failing noise request does not break *Compare runs*: the deltas show as before, without verdicts. A delta only loses its colour when the verdict is *within noise*; *not measured* keeps today's behaviour.
* The proposals were agreed on the design canvas (boards 71 and 72) before implementing; the *Variability* view is a tab of the run view, built with the shared `TabBar`.

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Compare the items that flipped between A and B (a sign test), with no repetitions | Needs no extra runs, but it assumes the only difference between A and B is what the user meant to change. A different model, temperature, judge or dataset version is read as a real effect, and no formula can detect that |
| A "measure noise" button in the dashboard that asks for a repeat of a chosen run | The dashboard cannot launch runs (ADR-028), so it would only hand out a command, and the user would have to pick the right code revision, dataset version and judge for the repeat to be comparable |
| Add a `Repeat` column to `eval_items` and `eval_scores` | Changes the sorting key of two partitioned, TTL-managed tables (a rebuild like migration 009) and touches every query. Grouping executions in Postgres reaches the same result with one migration and no analytical-store change |
| Always run 3 executions | Triples the cost of every evaluation for users who do not need the number |
| Run each item several times inside `task` | Hides the repetition inside user code: the platform could not tell repetitions from distinct items and could not compute instability per item |

## Consequences

* **Positive**: a delta can be read as signal or noise; the measurement is made under identical conditions by construction; existing runs and views keep working; no extra cost unless the user asks for it; the number is reusable by the PR gate later.
* **Negative**:
  * `repeats=N` multiplies evaluation time and tokens by N for whoever uses it.
  * Two or three executions give a rough σ; the screen says so instead of hiding it.
  * σ only applies while dataset version and judge stay the same; changing them requires measuring again.
  * The runs list gains a grouping level, and the vocabulary (run = group, execution = one pass) has to be explained in the user documentation.
  * A new field in the SDK contract must be added to both SDKs and the conformance suite in the same change.
* **Delivery** (each step on its own branch): (1) SDK `repeats` in Python and TypeScript, the Postgres migration and the upload/read API; (2) noise and verdict in *Compare runs* and the *Variability* view; (3) user guide in `docs-site/platform/evaluation.md` and the SDK pages. UI proposals are agreed on the design canvas before step 2.
