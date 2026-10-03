# ADR-040: Judge-vs-Human and Inter-Annotator Agreement

* **Status**: Accepted — implemented, including random sampling of queue items (ADR-039 amendment)
* **Date**: 2026-10-03
* **Deciders**: MemTrace Core Team
* **Depends on**: [ADR-029](adr-029-llm-as-judge-evaluators.md), [ADR-036](adr-036-score-configs-annotation-rubrics.md), [ADR-037](adr-037-human-annotations-storage-and-api.md); uses [ADR-039](adr-039-annotation-queues.md) multi-annotator queues as its main data source.

## Context and Problem Statement

LLM-as-a-judge evaluators (ADR-029) produce scores nobody has validated. The standard remedy is to label a sample by hand and measure how often the judge agrees. Without that number, a "92% pass rate" from a judge is unfalsifiable. Likewise, when several humans label the same item, their mutual agreement is the ceiling for how well any judge can be expected to do, and low agreement means the rubric (ADR-036) is ambiguous.

Two distinct questions:

1. **Judge vs human**: for the same target and the same criterion name, how often do `llm_judge` scores and human labels coincide?
2. **Human vs human**: how consistent are annotators among themselves?

## Decision Drivers

* Read-only analytics: no new tables, no new write path.
* Statistically honest: raw percent agreement is misleading on skewed data (95% "pass" -> a judge that always says "pass" gets 95%). Chance-corrected metrics are needed.
* Metrics must be comparable only when comparable (same name, same `DataType`).
* Computation is small (per run or per queue, hundreds to low thousands of pairs) and must be unit-testable pure code.

## Decision Outcome

### Where it is computed

A pure domain module `api/src/domain/agreement.ts` (no I/O) receives paired value lists and returns metrics. The application service fetches the two sides with bounded queries and calls it. **Not computed in ClickHouse SQL**: ClickHouse has `corr` but no Cohen's kappa; mixing SQL and TS implementations of "agreement" would make results inconsistent and hard to test.

### Pairing

* **Join key**: `(target, ConfigName == Score.Name)`.
  * Target for a trace-level pairing is `TraceId`; for run items it is `(DatasetRunId, ItemIndex)`. Run items **must** be supported because `scores.TraceId` is nullable (`DatasetRunItemSubmission.traceId: string | null`); a join on `TraceId` alone would silently drop every item the SDK ran without tracing. This is the reason `annotations` carries `TargetType` in ADR-037.
  * The SDK-side evaluator name and the `score_configs.name` must match exactly (case-sensitive). The response lists `unmatched: { judgeOnly, humanOnly }` and the UI shows it, so a user can see why a pair is missing.
* **Judge side**: only `Source = 'llm_judge'` scores. `code` scores (e.g. `exact_match`) with the same name as a rubric are never treated as the judge, and `human` scores in `scores` are not human labels here; human labels come only from `annotations`.
* **Queue scope**: a queue may mix `trace` and `run_item` targets. Judge-vs-human pairs only the queue's run items and counts the trace items in `scope.traceTargets` (a trace can appear in several runs, so it has no single judge score). Inter-annotator uses both kinds, since it does not need the judge. Only labels made with a config of the queue's rubric count, so labels the same people left elsewhere do not leak in.
* **Value parsing**: `Value` is a String on both sides (ADR-042). Values are parsed strictly per `DataType` (`true`/`false` exactly; finite numbers; non-empty labels). A value that does not parse is dropped and counted in `excluded.invalid`; it is never coerced to `NaN` or 0.
* **Types**: only pairs where both sides have the same `DataType` are computed. Otherwise the result carries `status: "incomparable"` with the reason.
* **Multiple human labels on one target**: the judge-vs-human metric needs one human value per target. Options: (a) majority vote, (b) restrict to targets with a single annotator, (c) report per annotator. Decision: **majority vote for boolean/categorical (ties excluded and counted), mean for numeric**, with the count of excluded targets always reported; the UI can switch to per-annotator view. Majority is a *reporting* convention only; it does not write ground truth anywhere (see ADR-039 out of scope).

### Metrics by data type

| DataType | Judge vs human | Human vs human |
|---|---|---|
| boolean | percent agreement, **Cohen's kappa**, confusion matrix (TP/FP/FN/TN, treating human as reference) | pairwise Cohen's kappa, averaged |
| categorical | percent agreement, **Cohen's kappa**, full confusion matrix | pairwise Cohen's kappa, averaged |
| numeric | **MAE**, **Pearson r**, **Spearman rho**; optionally "within ±1" rate | pairwise Spearman rho, averaged |

Notes:

* Cohen's kappa is undefined when expected agreement is 1 (both sides constant); return `kappa: null` with `reason: "no_variance"`, never `NaN`/`0`.
* With more than two annotators per target, pairwise kappa averaged is simple and explainable; **Krippendorff's alpha** handles missing labels and more than two raters properly. Decision: start with pairwise, and add alpha only if users need it (listed as open question), because alpha is harder to explain and test.
* A minimum sample size (default **n >= 20 paired targets**) below which the API still returns the numbers but flags `lowSample: true`. Kappa on 5 items is noise and the UI must say so.
* No confidence intervals initially; `n` is always returned so the reader can judge.

### API

```
GET /api/v1/experiments/:experimentId/agreement/judge-human
      ?datasetRunId=<id>              # or ?queueId=<id>; at least one scope required
      &name=<ConfigName>              # optional; omitted = every comparable name
-> { scope: { type, id, traceTargets },
     metrics: [ { name, dataType, status, reason?, judge, judges, n, excluded: { ties, noHuman, noJudge, invalid },
                  percentAgreement, kappa, kappaReason?, binary?, confusion?, mae?, pearson?, spearman?, withinOne?,
                  lowSample, disagreements: [ { target, judge, human } ] } ],
     unmatched: { judgeOnly, humanOnly } }

GET /api/v1/experiments/:experimentId/agreement/inter-annotator?queueId=<id>
-> { scope, metrics: [ { name, dataType, annotators, n, pairs, meanPairwiseKappa?, meanPairwiseSpearman?, lowSample } ] }
```

For a queue scope the response also carries `scope.population: { manual, filter, randomSample }`, counting the queue's run items by how they were chosen (ADR-039 amendment); the card says whether the sample is random and warns when it is not.

`status` is `ok`, `incomparable` (different `DataType` on the two sides) or `mixed_judges`. `disagreements` are capped at 100; `target` is `run:<datasetRunId>:<itemIndex>` so the UI can link to the item. Numeric disagreements are those with |judge − human| > 1.

Scope is always bounded (a run or a queue) so queries stay cheap and the data is meaningful (one population). An unbounded "whole experiment" agreement is deliberately not offered in this ADR: it would mix judge versions and rubric versions and give a number no one can act on.

### Judge identity

[ADR-043](adr-043-record-judge-identity-on-scores.md) now stores `JudgeModel` and `JudgePromptHash` on every `llm_judge` score. Each metric in the response carries the `judge: { model, promptHash }` it was computed for (`judges` lists every identity seen; `judge` is `null` when there is more than one). Scope stays a run or a queue (one population), but a run whose scores mix several judge identities for the same name (a re-upload with a changed judge) is reported as `status: "mixed_judges"` instead of averaged. Scores written before ADR-043 have null identity and are grouped as one "unknown judge". Comparing agreement across runs becomes possible only for runs with equal identity; a cross-run view is left to a later ADR.

### UI

* On `DatasetRunDetailPage.vue`: an "Agreement with human labels" card showing per-evaluator kappa, confusion matrix and the list of disagreeing items with a link to each (the high-value output: *where* judge and human differ, so the judge prompt can be fixed).
* "Add run items to a queue" from this page (ADR-039) to collect the human side; the card shows `n` and a "needs more labels" state below the minimum.
* On the queue page: inter-annotator panel.
* Charts follow existing `custom-metric-chart-option.ts` conventions; no new chart library.

## Design Implications

* **Zero schema changes**: everything is derived. The cost is that correctness depends on ADR-037's denormalized `ConfigName`/`DataType` and on a stable naming convention between SDK evaluators and score configs. Documented in user docs: "name your human rubric like your evaluator".
* **Class imbalance** is handled by reporting kappa and the confusion matrix next to percent agreement; docs explain that high percent with low kappa means "mostly the same label".
* **Selection bias**: if reviewers label only items the judge flagged as failing, the sample is biased and agreement is not generalizable. The UI states how the sample was built (queue population method) next to the numbers; random sampling of run items into a queue is the recommended workflow and a "random sample N" option should be added to queue population for this reason (small addition to ADR-039's filter population).
* **Performance**: scoped to a run/queue; two bounded queries (`annotations FINAL` and `scores FINAL` filtered by run) plus an in-memory pass. Goes through the existing query limiter.
* **Not an automatic judge calibration**: this ADR only measures. Automatically tuning the judge from labels is out of scope.

## Consequences

* **Positive**: makes LLM-as-judge results defensible; identifies ambiguous rubrics via inter-annotator kappa; finds judge failure cases concretely; no storage cost.
* **Negative**: metrics are only as good as sample size and sampling method; mitigated by `n`, `lowSample` and sample-description UI, not eliminated.
* **Negative**: no cross-run trend yet; ADR-043 provides the identity needed to add one.

## Open Questions

* Krippendorff's alpha instead of averaged pairwise kappa.
* Weighted kappa for ordinal categories (uses the config's numeric `value`s from ADR-036).

## Implementation Checklist

- [x] `domain/agreement.ts` with unit tests (textbook kappa, no-variance, ties, low sample, incomparable types, invalid values)
- [x] Repository reads: human labels (`AnnotationRepository.listForRuns` / `listForTraces`) and judge scores (`ScoreRepository.listJudgeScoresForRuns`), scoped to runs
- [x] `AgreementService` + routes + schemas + contract + tests
- [x] Dashboard: `JudgeHumanAgreement` card on `DatasetRunDetailPage.vue` (with "send items to a review queue"), `InterAnnotatorAgreement` and the judge-human card in the queue details; fakes and tests
- [x] Docs: `docs-site/library/evaluation.md`, `docs-site/platform/api.md`
- [x] Random sample when populating a queue, with item provenance (ADR-039 amendment); `scope.population` in the judge-human response, shown on the agreement card
