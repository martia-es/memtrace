# ADR-043: Record Judge Identity (Model and Rubric Fingerprint) on Scores

* **Status**: Accepted
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Amends**: [ADR-029](adr-029-llm-as-judge-evaluators.md) (which stated "no schema change needed on the ClickHouse `scores` table"). Unblocks cross-run comparison in [ADR-040](adr-040-judge-human-agreement.md). Storage later reshaped by [ADR-044](adr-044-eval-items-and-scores-tables-telemetry-from-traces.md).

> **Update ([ADR-044](adr-044-eval-items-and-scores-tables-telemetry-from-traces.md)):** the table `memtrace.scores` named below was replaced by `eval_items` + `eval_scores`. `JudgeModel` and `JudgePromptHash` carry over unchanged to `eval_scores` (migration 008); the SDK/API contract (`judgeModel` / `judgePromptHash`) and the decisions here still hold. The text below records the original decision.

## Context and Problem Statement

A `Score(source="llm_judge")` stored only `name`, `value`, `dataType`, `source` and `comment`. Nothing recorded *which model* judged or *with which rubric*. ADR-029 treated the judge as an implementation detail, since the only question then was "did the answer pass". Two things changed that:

1. A pass rate from a judge is only comparable between runs if the judge was the same. Switching the judge model, or editing a rubric, silently shifts every number, and the dashboard's run-over-run charts (Metrics -> Offline evals) would show it as an agent regression or improvement.
2. Judge-vs-human agreement (ADR-040) measures *a specific judge*. Without identity, it could only be computed inside one run.

## Decision Outcome

1. **Two nullable columns on `memtrace.scores`** (`migrations/clickhouse/006_score_judge_identity.sql`): `JudgeModel Nullable(String)` and `JudgePromptHash Nullable(String)`. `ORDER BY` is untouched, so idempotent re-uploads of a batch (ADR-034) behave as before. `NULL` for non-judge scores and for rows written before the migration (not reconstructable).

2. **SDK `Score` gains `judge_model` and `judge_prompt_hash`** (both optional). `LLMJudgeEvaluator` fills them; any other evaluator leaves them `None`. They travel as `judgeModel` / `judgePromptHash` in the run upload and come back in `ScoreDto`. Both are optional in the API schema (default `null`), so older SDKs keep working.

3. **Model resolution**: the explicit `model=` given to the judge, else the client's `model` attribute (optional on the `LLMClient` protocol; `AnthropicJudgeClient` exposes it), else `None`. The protocol's single method is unchanged, so existing custom clients still work; they just do not report a model unless they add the attribute or the judge gets `model=`.

4. **`judge_prompt_hash` fingerprints the rubric, not the item**: first 16 hex chars of SHA-256 over `system_prompt()` plus `build_prompt()` rendered with placeholders (`{input}`, `{output}`, `{expected_output}`, and a metadata mapping that resolves any key to `{key}`). It is therefore identical for every item of a run and changes exactly when the judge text changes. If a custom judge's `build_prompt` cannot render placeholders, it falls back to hashing the class's qualified name (stable, but blind to prompt edits; documented limitation).

5. **Dashboard**: the score tooltip on the run detail page shows the model and rubric hash. No filtering or comparison UI yet.

## Consequences

* **Positive**: runs are attributable to a judge; comparability can be checked (same model + hash); ADR-040 can lift its single-run restriction.
* **Negative**: the hash does not capture sampling parameters (temperature, max tokens) because `LLMClient.complete` does not take them, nor model-side drift behind an unchanged alias (e.g. a floating model name). Recording the provider's resolved model id from the response would need a richer return type than `str`; deferred.
* Historical scores stay anonymous; no backfill.

## Follow-up: judge-change warning in Metrics -> Offline evals (2026-10-03)

`ScoreAggregate` / `ScoreAggregateDto` now carry `judges`: the distinct `(model, promptHash)` pairs of the `llm_judge` scores behind each (run, evaluator), computed with `groupUniqArrayIf` in `aggregateForRuns`. Empty for code/human evaluators. More than one entry means the run mixes judges, e.g. a re-upload with a different judge or rows from before this ADR (`null`, `null`).

The dashboard compares each evaluator with the **last earlier run that had the same evaluator** (runs without it are skipped). A change is flagged only when **both** sides have a judge and their signatures differ; code evaluators and runs with no judge on one side are never flagged. A pair of `null` identities counts as "unknown model / rubric n/a", so a run from before the migration followed by a recorded judge is flagged as changed (we cannot prove it is the same judge). The panel then shows:

* a diamond in the danger colour on the affected chart points,
* an alert listing each change (evaluator, previous run -> run, old -> new judge),
* "judge changed" instead of the "vs. previous" delta on the latest-run KPI.

The warning is advisory: nothing is hidden or blocked, and the chart still draws the line through the change.
