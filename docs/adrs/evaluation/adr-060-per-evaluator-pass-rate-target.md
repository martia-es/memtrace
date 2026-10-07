# ADR-060: Per-Evaluator Pass Rate Target on Score Configs

* **Status**: Accepted — implemented (API + dashboard)
* **Date**: 2026-10-06
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-036](adr-036-score-configs-annotation-rubrics.md)

## Context and Problem Statement

The Evaluations → Trends page judged every boolean evaluator against a hard-coded 80% target (target line in the chart, KPI tone, verdict, "Needs attention" list, bar marker). Different evaluators and experiments need different bars (a safety check at 99%, an exploratory one at 60%), and the target is a property of the experiment, not of the dashboard.

## Decision Drivers

* The target must be configurable per experiment, and ideally per evaluator.
* Do not introduce a new concept if an existing per-experiment object already matches evaluators by name.
* Existing experiments must keep behaving as today without any migration of data.

## Considered Options

1. **Optional `target_pass_rate` on `score_configs`** (chosen). ADR-036 already declares per-experiment rubrics keyed by `name`, and the same name is what offline evaluators emit, so a boolean config is the natural place to say "this evaluator should pass X%".
2. **One target per experiment.** Simpler, but a single number cannot fit a mix of strict and exploratory evaluators.
3. **Target on the assistant registry.** Rejected: one assistant has several experiments with different demands, and the registry does not know about evaluators.
4. **A new `evaluator_targets` table.** Rejected: duplicates the name-keyed per-experiment object we already have.

## Decision Outcome

* `migrations/postgres/027_score_config_target.sql` adds nullable `target_pass_rate` (`0 < x <= 1`), allowed only when `data_type = 'boolean'`.
* Domain: `ScoreConfig.targetPassRate`; validated on create and editable through `PATCH` (`null` clears it). It is **not** an invariant of the rubric (unlike range/categories) because it does not reinterpret existing labels, so it can go up or down freely.
* Dashboard: Trends loads the experiment's score configs, builds `{ evaluatorName → target }` and uses it for the chart target line, the KPI tone, the bar marker, the verdict and the attention list. Evaluators without a config (or with `null`) use `DEFAULT_TARGET_PASS_RATE = 0.8`. If the configs can't be read, the page degrades to the default.
* The "failing" threshold stays at `min(50%, target)`.

## Consequences

* An evaluator needs a boolean score config with the same name to get its own target; this reuses the name matching ADR-036/ADR-040 already rely on.
* Other screens that colour pass rates (run list, run detail, dataset detail) still use the default 80% (`aggregateTone` accepts an optional target for when they are wired).
* Only a technical profile (`scoreconfig:manage`) can change a target.
