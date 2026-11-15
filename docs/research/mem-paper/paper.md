# From OpenTelemetry Traces to Failure Rules: Deterministic Episode Construction and Statistically Filtered Rule Discovery for LLM Agents

*Draft v0.5 — MemTrace team. Working paper; not peer reviewed. All numbers come from `experiments.py` in this directory (5 development and 5 held-out seeds); see Section 9. v0.4 expands the method description (step-by-step construction, formulas and pseudocode); the results of Sections 6.1–6.5 and 7 are those of v0.3, which reports the final method on held-out seeds, after fixing a defect and testing mitigations (Section 7). v0.5 adds confirmation of each rule on reserved episodes, recomputes the reported statistics for the final (generalised) rule (Sections 5.5, 5.9) and evaluates both on fresh seeds (Section 6.6).*

## Abstract

Teams that operate LLM agents already emit OpenTelemetry (OTel) traces, but turning those traces into actionable knowledge — *what fails repeatedly, under which conditions, and has it been fixed?* — is still mostly manual. We describe the first two stages of the learning pipeline of MemTrace, an open observability platform: (1) **episode construction**, which collapses the spans of an OTel GenAI trace into one row with ordered steps, a *decisive span* and a multi-signal outcome estimate, and (2) **rule discovery**, which proposes human-readable conditions *associated with* recurring failures, using sequential coverage; each rule can then be confirmed with an exact test on episodes the search never saw. Neither stage calls an LLM, both run as idempotent batch jobs over the trace store, and every derived row is reproducible from the traces. On synthetic traces with seeded failure modes, evaluated on **five held-out seeds** never used during development, the pipeline recovers the seeded failures with mean recall 0.86–1.00 and 0.2 spurious findings per run on average, whereas an error-summary baseline (what dashboards do) reaches recall 0.64–0.67 on silent failures at purity 0.30–0.51, and a single decision tree misses the confounded failure (recall 0.07). Ablations show that sequential coverage, a request-level entity feature and rule generalisation each recover a distinct failure; goal clustering has a mixed effect (it improves one failure's purity but lowered silent-failure recall in 2 of 5 held-out seeds); and we find no measurable benefit of the exact test on held-out data. Development exposed a defect that single-seed validation had hidden (a near-universal rule in 2 of 5 development seeds), which we analyse and fix; we then test three mitigations of residual noise on held-out seeds and adopt only the one that does not reduce recall. The evaluation uses one synthetic, author-designed generator for a single domain, which limits what it supports; the rules describe associations with an estimated outcome, not causes.

## 1. Introduction

An agent run is a tree of operations: model calls, tool calls, retries. OpenTelemetry's GenAI semantic conventions (`gen_ai.*`) standardise how those operations are recorded, so the same trace can be produced by different frameworks. Observability tools use traces to *display* runs and aggregate metrics. What is missing is the step before any improvement loop (prompt change, guardrail, memory): finding **which failures recur and why**, from the traces alone.

Three properties make this harder than classical log mining:

1. **Failure is not a field.** A trace without an error span can still be wrong (a *silent* failure). Evidence is spread across weak signals: error spans, retry loops, evaluator scores, end-user thumbs.
2. **Causes live in behaviour, not only in context.** "The agent called the forecast tool before geocoding" or "it compared two cities but queried one" are properties of the *sequence* of steps and of the request.
3. **Recurrence needs significance.** With thousands of candidate conditions, some will separate failures from successes by chance; a system that proposes fixes from them will persist noise.

**Contributions.** (i) An episode abstraction over OTel GenAI spans with a decisive-span definition and a versioned, additive outcome estimate (Sections 3 and 4). (ii) A rule-discovery procedure that generates features automatically, searches with sequential coverage, and filters with Fisher's exact test, with Bonferroni correction, on episodes reserved from the search (Sections 5 and 5.9); the empirical benefit of the test itself is not established (Sections 6.4 and 6.6). (iii) An evaluation with baselines and ablations on development and held-out seeds (Section 6), including the analysis and fix of a robustness defect that single-seed validation had hidden, and a held-out test of three mitigations (Section 7). We deliberately scope this paper to *knowledge extraction from traces*; what is done with the knowledge (lessons, approvals, applying them to a prompt) is out of scope.

## 2. Related work

**Trace observability and analysis.** OTel standardises collection but, as AgentGraph argues, not the semantic structure of reasoning. AgentGraph (Wu et al., AAAI 2026 demo) converts traces into typed knowledge graphs linked to their source spans and performs trace-grounded failure detection and perturbation-based robustness testing. TraceBrain (Le et al., 2026) proposes a delta-based OTLP schema to reduce storage, uncertainty-driven prioritisation of trajectories for human review, and hybrid retrieval over trace history. Commercial tools (LangSmith Insights, Braintrust Topics, Arize) cluster traces; clustering describes *what kind* of runs exist but does not by itself give a testable condition separating failures from successes.

**Learning from trajectories.** Reflexion and ExpeL generate reflections or rules from trajectories with an LLM; ExpeL contrasts successful and failed trajectories. Fang et al. (IBM Research, 2026) extract structured learnings with provenance from agent trajectories — including a decision-attribution step that separates decisions that caused failures, enabled recovery or were merely inefficient — and report gains on AppWorld from injecting them in prompts. MAST proposes a taxonomy of multi-agent failure modes. These systems rely on an LLM for extraction; our setting is complementary: a deterministic, auditable first stage whose output (rules with support, lift and p-value) can later be handed to an LLM or a person.

**Rule and subgroup discovery.** Explaining a binary outcome with conjunctive conditions is subgroup discovery; sequential covering is the classic strategy of rule learners. Our contribution is not the algorithm but its adaptation to trace-derived features, a multi-signal outcome, and a production setting (idempotent batch, versioning, tenancy).

*Note: related-work statements about other systems are taken from their abstracts and from our design notes; they should be checked against the full papers before submission.*

## 3. From OTel spans to episodes

### 3.1 Input

The input is the span table of an OTel store (here ClickHouse, `otel_traces`) plus two side tables: end-user feedback (thumbs) and evaluator scores. A *step* is a span whose `gen_ai.operation.name` is `chat` or `execute_tool`; other spans (invocation wrappers, custom spans) provide structure but are not steps. Tool steps are named by `gen_ai.tool.name`.

### 3.2 The episode

One trace becomes one **episode** row:

| Field | Definition |
|---|---|
| `Steps` | ordered step names (`chat` or the tool name) |
| `Goal`, `Answer` | user request and final model reply (truncated to 500 characters; already PII-masked at the SDK) |
| *decisive span* | the failing span that is not the parent of another failing span (parents inherit errors from children); with several independent leaves, the earliest in time, since it triggers the rest |
| `HasError`, `Loop` | an error span exists; a *loop* exists |
| `Thumbs`, `EvalScore` | user feedback and the minimum evaluator score (only boolean or [0, 1] scores, read as fail/pass) |
| `Attributes` | trace attributes with short values, filtered by an exclusion list (no `gen_ai.*`, `enduser.*`, keys containing id/email/name/token…, long values or values with `@`) |
| `EmptyArgTools` | tools called with at least one empty argument (generic: no tool names are hard-coded) |
| `Outcome`, `Value`, `Reasons` | see Section 4 |

A **loop** is the same tool call (same name and same argument string) or the same normalised model error occurring at least three times in the trace (not necessarily consecutively). Error messages are normalised by replacing every digit sequence with the placeholder `N` and truncating to 120 characters, so quota codes, ids or timings do not split one error into many.

### 3.3 Construction, step by step

For each trace (`trace_id`), the builder runs the following steps; all of them are pure functions of the span rows and the two side tables.

1. **Order and filter.** Sort the spans by timestamp. Keep as *steps* those with `gen_ai.operation.name ∈ {chat, execute_tool}`. If there are no steps, the trace produces no episode. The step name is `chat` for model calls and `gen_ai.tool.name` for tool calls (the span name if the tool name is missing).
2. **Goal and answer.** `Goal` is the text of the last `user` message inside the input messages of the first chat span that has one; `Answer` is the text of the last `assistant` message of the last chat span that has one. Messages follow the GenAI format (plain `content` or a list of `parts`); both are truncated to 500 characters.
3. **Decisive span.** Let *F* be the spans with status error. Let *P* be the set of parent ids of the spans in *F*. The leaves are the spans in *F* that are not in *P*; the decisive span is the leaf with the smallest timestamp (if there were no leaves, the earliest span of *F*). `decisive_step` is its step name and `decisive_error` is its normalised status message. If *F* is empty, the trace has no error (`HasError = false`).
4. **Loop.** Count occurrences of the key `(tool name, argument string)` for every tool step, and of the normalised message for every failing chat step; `Loop` is true if any count reaches 3.
5. **Feedback.** `Thumbs = +1` if there is at least one thumb up and no thumb down, `−1` if the reverse, and `0` if there are none or both (a contradictory vote is recorded in `Reasons` as `thumbs_mixed` and carries no weight).
6. **Evaluator score.** `EvalScore` is the minimum of the scores of all evaluators that ran on the trace. It counts as *fail* if it equals 0 and as *pass* if it equals 1; an intermediate value (for example 0.5) is neither and adds nothing to the outcome.
7. **Empty arguments.** For each tool step, the argument string is parsed as JSON; if it is an object with at least one value equal to `""` or `null`, the tool name is added to `EmptyArgTools`. No tool names are hard-coded.
8. **Attributes.** The attributes of the root span are kept if the key does not start with `gen_ai.`, `memtrace.input|output|metadata`, `enduser.`, `http.` or `url.`; none of the tokens of the key (split on `.`, `_`, `-`) is in `{id, email, phone, name, token, key, secret, password, address, ip, message}`; and the value is non-empty, at most 64 characters, and has no `@`. This is an exclusion list, so it must be reviewed when new keys appear.
9. **Outcome.** Computed as in Section 4.

### 3.4 Engineering properties

The episode table is *derived*: it can be dropped and rebuilt from the traces. A batch job runs every ten minutes, takes traces that have had no new spans for a settle window, and also recomputes those that received a late signal (a thumb or a score). Rows are written to a `ReplacingMergeTree` keyed by trace (last write wins), so a pass without news writes nothing. Every row carries an `EpisodeVersion`; changing weights, thresholds or the loop definition bumps it and the job recomputes the old rows. Every row carries the tenant (experiment) identifier and follows the traces' retention.

## 4. Outcome estimation

The outcome is an **estimate from weak signals, not a label**. Each signal adds a fixed weight to a value; thresholds map the value to `ok`, `suspect` or `failed`:

| Signal | Weight |
|---|---|
| error span | +1.0 |
| loop | +0.8 |
| evaluator = 0 | +0.7 |
| thumbs down | +0.6 |
| thumbs up | −0.3 |
| evaluator = 1 | −0.2 |

Formally, with indicator variables *e* (error span), *l* (loop), *d* (thumbs down), *u* (thumbs up), *v⁻* (minimum evaluator score = 0) and *v⁺* (minimum evaluator score = 1):

> value = 1.0·e + 0.8·l + 0.7·v⁻ + 0.6·d − 0.3·u − 0.2·v⁺

and `Outcome = failed` if value ≥ 0.6, `suspect` if 0.3 ≤ value < 0.6, `ok` otherwise. The comparison is inclusive, so a single thumb down (0.6), a loop (0.8), an evaluator failure (0.7) or an error span (1.0) is enough on its own to mark `failed`; a lone thumb up or evaluator pass gives a negative value and `ok`. Some worked cases: error + thumb up = 0.7 → `failed`; loop + evaluator pass = 0.6 → `failed`; thumb down + evaluator pass = 0.4 → `suspect`; evaluator failure + thumb up = 0.4 → `suspect`. The value is rounded to two decimals before thresholding. The `Reasons` list records which positive signals contributed (`error_span`, `retry_loop`, `eval_failed`, `thumbs_down`, `thumbs_mixed`), so a human can see why an episode is `failed`.

*Evaluator scores* are scores written by an automatic evaluator (a heuristic check, an LLM judge or a classifier, run outside this pipeline) into a side table keyed by trace; this pipeline only reads them. Only boolean or [0, 1] values are accepted, with the convention 0 = fails and 1 = passes. Weights were set by hand and checked on synthetic data (Section 6); they are not learned, and Section 8 discusses what this implies.

## 5. Rule discovery

Discovery runs per agent (tenant) over the episodes of an analysis window, once there are at least 200 episodes and at least 30 `failed` ones (below that no statistical test is meaningful). Its parameters are: minimum support *s* = 30, minimum lift *L* = 1.5, significance α = 0.01, at most 12 rules per cause, tree depth 3, and at most 20 distinct values for a context attribute.

### 5.1 Features, generated without domain knowledge

Every episode becomes a row of numeric or 0/1 features. No tool, city or failure name is written by hand.

* **Context.** Each trace attribute with at most 20 distinct values in the window becomes one indicator per value (`user.lang=es`, `model=model_b`, `prompt.version=2`). Attributes with more values are treated as identifiers and ignored.
* **Behaviour.** For every step name *n*: `count:n`, how many times it occurs. For every ordered pair of distinct tools (*A*, *B*): `A_before_B`, equal to 1 if both occur and the first occurrence of *A* precedes the first occurrence of *B*. For every tool: `empty_arg:A`, 1 if it was called with an empty argument. Plus `max_repeat_of_a_step` (length of the longest run of the same step, for example 3 in `chat, f, f, f, chat`) and `n_steps`.
* **Request.** `goal_entities` is the number of tokens of the goal that look like entities: after masking (below), the count of `<name>` plus `<n>` placeholders. It captures requests such as "compare A and B" (two entities) without any named-entity model. `goal_cluster=c` are indicators of the goal cluster (5.2).

**Masking.** Numbers (`\b\d+([.,]\d+)?\b`) are replaced by `<n>`. A word with an initial capital that is preceded by a word character or a comma/semicolon and a space (so it does not open the sentence) is replaced by `<name>`. This is a lexical heuristic that suits English and Spanish; it is not language-aware, and a capitalised common noun mid-sentence is also masked.

### 5.2 Goal clusters

Goals are masked (entities change the text but not the intent), de-duplicated, and embedded with a local multilingual sentence encoder (`paraphrase-multilingual-MiniLM-L12-v2`, shipped in the job image: no network calls; vectors are L2-normalised). For each *k* from 3 to min(14, number of distinct masked goals − 1) we run k-means (10 initialisations, fixed random seed 0) and compute the mean silhouette coefficient; we keep the *k* with the highest silhouette. The silhouette of a point is (*b* − *a*) / max(*a*, *b*), where *a* is its mean distance to the points of its own cluster and *b* its mean distance to the nearest other cluster, so values near 1 mean compact, well-separated clusters. If there are 3 or fewer distinct masked goals, no clustering is done. Each cluster becomes an indicator feature.

### 5.3 Cause split

Failed episodes are partitioned into disjoint groups called *causes* (a *failure signature*: the failing step and error it shows; the name does not imply that the step causes the failure). An episode with an error span goes to the group *(decisive step | normalised error)*; every `failed` episode without an error span goes to a single group `(no error)` (silent failures). Groups with fewer than 30 episodes are skipped. Each group *g* is explained separately, as a binary problem: *y* = 1 for the episodes of *g*; the **training set** contains all non-failed episodes plus the episodes of *g*. Failures of other causes are removed from it, so they never count as negatives of *g*.

### 5.4 Sequential coverage

For each cause the following loop runs, at most 12 times:

1. **Propose.** Fit a CART decision tree (scikit-learn `DecisionTreeClassifier`, `max_depth = 3`, `min_samples_leaf = 30`, `random_state = 0`) on the current training set. Each root-to-leaf path is a **conjunctive rule**: a list of at most three conditions `feature ≤ t` or `feature > t`. For a 0/1 feature the threshold is 0.5, so a condition reads "feature is 0" or "feature is 1".
2. **Score each candidate.** For a candidate with mask *m* (the episodes that satisfy all conditions) build the 2 × 2 table: rows = inside / outside the rule, columns = in cause *g* / not, counted on the current training set. Then
   * **precision** = failures of *g* inside the rule ÷ episodes inside the rule;
   * **base rate** = share of *g* in the training set;
   * **lift** = precision ÷ base rate (how many times more likely a failure of *g* is inside the rule than overall);
   * **p-value** = one-sided Fisher exact test (`alternative = greater`) on the 2 × 2 table, i.e. the probability of seeing at least this many failures of *g* inside the rule if the rule were unrelated to the failure, with the margins fixed.
   Candidates with fewer than 30 episodes in the leaf or lift below 1.5 are discarded. The number of surviving candidates is added to a counter *T* that is **never reset within a pass** (all rounds and causes).
3. **Select and test.** The candidate with the smallest p-value is chosen. It is accepted only if **p × T ≤ α** (Bonferroni over all candidates tested so far in the pass; the earlier, weaker variant multiplied by the number of candidates of the current round only, see Section 7.2). If it fails, the search for this cause stops.
4. **Generalise** the rule (5.5) and recompute its mask on all episodes.
5. **Check support.** If the generalised rule contains fewer than 30 failures of cause *g*, the search for this cause stops. (Two optional guards, a cap on the share of all episodes covered and a minimum precision, exist in the code but are off; Section 7.2.)
6. **Record and remove.** Store the rule with its support (episodes covered), failures, failure rate, lift and p-value, and remove from the training set the failures of *g* that it covers (the negatives stay). Go to step 1: the new tree must explain what remains.

Removing explained failures is what allows smaller or confounded failures to become the best split in later rounds; a single tree never reaches them (Section 6).

### 5.5 Generalisation

A depth-3 path can contain conditions that add nothing. Starting from the rule *R* with precision *p₀* measured on the training set, repeat: for each condition, form the rule without it; accept the first removal whose rule *R′* satisfies all of (i) precision(*R′*) ≥ 0.95 · *p₀*, (ii) it covers at least 30 episodes, (iii) lift(*R′*) ≥ 1.5. Precision and lift are measured on **the same training set as the search** (Section 7.1 explains why). Stop when no condition can be removed or one remains. From discovery version 4 the reported lift and p-value are recomputed for the **final, generalised rule** (before, they were those of the tree's rule, so the stored rule did not have the reported statistics); `p_value_before_generalisation` keeps the tree rule's value for comparison.

### 5.6 Merging and recurrence

Two merge steps run after all causes are done.

1. **Overlap merge (same cause).** Findings are sorted by number of failures, descending. A finding is merged into an earlier one of the same cause if the Jaccard overlap of their sets of failed trace ids, |*A* ∩ *B*| ÷ |*A* ∪ *B*|, is at least 0.5; the larger finding is kept and the other rule is listed under it as a merged rule.
2. **Signature merge (across causes).** Two findings have the same signature if they share the decisive step, decisive error, most common tool sequence and the same set of behavioural features in their rules (features other than `goal_cluster` and `user.lang`). They are merged into one: its rule is the disjunction of the rules, its members the union of their traces, and support, failures and failure rate are recomputed on that union.

For each finding we also report **occurrences per 100 traces by prompt version** (episodes covered with that version ÷ episodes of that version × 100), as observational monitoring after a change. A drop is not evidence that the change fixed the failure: traffic mix, language, model or concurrent changes can explain it, and a causal claim needs a controlled or matched comparison. The *finding id* is a hash of cause and rule text, so it is stable across passes. Failed episodes covered by no finding are reported as *unexplained* with their three most common errors.

### 5.7 Pseudocode

```text
discover(episodes):
  if too few episodes or failures: return []
  X <- features(episodes)            (5.1, 5.2)
  causes <- split failures           (5.3)
  T <- 0 ; found <- []
  for each cause g with >= 30 episodes:
    y <- 1 if episode is in g
    train <- everything except the
             failures of other causes
    repeat at most 12 times:
      cands <- leaves of depth-3 CART
               on train                (5.4)
      keep cands with lift >= 1.5
      if none: stop
      T <- T + number of cands
      r <- cand with smallest p
           (one-sided Fisher)
      if p(r) * T > 0.01: stop
      r <- generalise(r)             (5.5)
      if failures of g in r < 30: stop
      found <- found + r
      train <- train minus the failures
               of g that r covers
  merge by overlap, then signature (5.6)
  return found, plus occurrences per
    100 traces by prompt version
```

### 5.8 Complexity and determinism

The tree has at most 8 leaves per round, so at most 8 Fisher tests per round; the cost is dominated by building the feature matrix (the number of ordered tool pairs grows with the square of the number of tools) and by the embedding. Every random component has a fixed seed (tree, k-means), and the ordering of ties is fixed by sorting, so the same episodes always produce the same findings.

### 5.9 Confirmation on reserved episodes

The search selects rules with the same outcome labels that the test then uses, so the p-values of 5.4 are *exploratory scores* (they rank and filter candidates; they are not a valid confirmatory test). With `validation_split = f > 0`, a fraction *f* of the episodes, chosen by a hash of `trace_id` (stable across passes), is hidden from the search: features, trees, generalisation and sequential coverage use only the remaining episodes. Each final (generalised) rule is then measured on the reserved episodes, with the same negatives convention as the search (failures of other causes removed). It is *confirmed* if its lift there is at least 1.5 and its one-sided Fisher p-value multiplied by *R* is at most α, where *R* is the number of rules proposed for confirmation; *R* is known before the reserved episodes are looked at, so this Bonferroni correction controls the family-wise error over a fixed family. The reported lift and p-value of a confirmed finding are the reserved-set values; the search-set values are kept as `discovery_lift` and `discovery_p_value`. The default is `f = 0` (exploratory mode).

## 6. Evaluation

### 6.1 Data

We use a generator of synthetic traces for a weather agent (two tools, `geocode` and `get_forecast`), emitted in the shape of `otel_traces`, with end-user feedback and evaluator scores. Failure modes are **seeded** with known frequency; the pipeline never reads the ground truth, which is used only for scoring.

| Id | Seeded failure | What it tests |
|---|---|---|
| F1 | request without a city → tool called with empty `city` and fails | easy, error span |
| F2 | retry loop after a 429 | sequence pattern |
| F3 | compares two cities but queries one (no error; only thumbs/evaluator) | silent failure |
| F4 | calls `get_forecast` before `geocode` | step order |
| F5 | fails only for Spanish **and** `model_b` (wrong units), no error | confounders |
| F6 | random transient failures | noise: must not become a finding |

Signals are noisy by construction: for silent failures the user gives a thumb down with probability 0.55 and the evaluator returns 0 with probability 0.7; for failures with an error, 0.3 and 0.9; for successes, a thumb in 15 % of traces (7 % of them wrong) and an evaluator score in 60 % (3 % wrong). We generate 5,000 traces per seed (≈ 1,450 truly failed). **Development seeds** (7, 11, 13, 17, 19) were used throughout development: the defect of Section 7.1 was found on them and the thresholds of the mitigations in Section 7.2 were chosen after seeing their residual errors, so they are contaminated for those purposes. **Held-out seeds** (23, 29, 31, 37, 41) were generated and scored only after the method and the mitigation candidates were fixed. Headline results use the held-out seeds; mean ± standard deviation is across seeds.

### 6.2 Metrics

*Finding quality.* For each seeded mode, take the finding maximising recall × purity, where recall is the share of the mode's traces covered by the finding and purity is the share of the finding's traces belonging to the mode. F6 is noise: **its recall should be low.** A finding is *spurious* if no mode among F1–F5 makes up at least half of its traces. *Outcome quality.* Precision/recall of `Outcome = failed` against the generator's `failed` flag.

### 6.3 Baselines and ablations

* **Error summary**: group failed episodes by *(failing step, error)*, with one group for silent failures — what error dashboards offer.
* **Single decision tree**: one depth-3 tree on the same features, no statistical test, no sequential coverage, no merging.
* Ablations of the final pipeline: no goal clusters; no entity feature; no Fisher/Bonferroni (α = 10⁹, so any candidate with lift ≥ 1.5 passes); no generalisation; one rule per cause (no sequential coverage); no cause split.

### 6.4 Results: finding quality

Final pipeline, **held-out seeds** (23, 29, 31, 37, 41). Recall of the best finding per seeded mode:

| Variant | F1 | F2 | F3 | F4 | F5 | F6 (noise) | findings | spurious |
|---|---|---|---|---|---|---|---|---|
| **Full pipeline** | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.86 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.15 ± 0.07 | 6.2 ± 0.4 | 0.2 ± 0.4 |
| − goal clusters | 1.00 ± 0.00 | 0.94 ± 0.02 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.13 ± 0.01 | 7.2 ± 0.8 | 0.8 ± 0.4 |
| − entity feature | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.66 ± 0.01 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.14 ± 0.07 | 7.0 ± 0.6 | 0.2 ± 0.4 |
| − Fisher/Bonferroni | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.86 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.15 ± 0.07 | 6.2 ± 0.4 | 0.2 ± 0.4 |
| − generalisation | 1.00 ± 0.00 | 0.96 ± 0.02 | 0.62 ± 0.08 | 1.00 ± 0.00 | 0.91 ± 0.01 | 0.13 ± 0.05 | 7.0 ± 0.0 | 0.6 ± 0.5 |
| − sequential coverage | 1.00 ± 0.00 | 0.94 ± 0.02 | 0.86 ± 0.17 | 0.80 ± 0.02 | 0.07 ± 0.01 | 0.09 ± 0.03 | 4.0 ± 0.0 | 0.0 ± 0.0 |
| − cause split | 0.95 ± 0.09 | 0.94 ± 0.02 | 1.00 ± 0.00 | 0.93 ± 0.09 | 1.00 ± 0.00 | 0.13 ± 0.01 | 4.8 ± 0.4 | 0.0 ± 0.0 |
| *Baseline: error summary* | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.67 ± 0.02 | 0.80 ± 0.02 | 0.64 ± 0.04 | 0.48 ± 0.02 | 6.0 ± 0.0 | 2.2 ± 0.4 |
| *Baseline: single tree* | 1.00 ± 0.00 | 0.83 ± 0.02 | 1.00 ± 0.00 | 0.80 ± 0.02 | 0.07 ± 0.01 | 0.10 ± 0.03 | 3.0 ± 0.0 | 0.0 ± 0.0 |

Purity of the best finding (held-out):

| Variant | F1 | F2 | F3 | F4 | F5 |
|---|---|---|---|---|---|
| **Full pipeline** | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| − goal clusters | 0.44 ± 0.02 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.52 ± 0.01 |
| − entity feature | 1.00 ± 0.00 | 0.80 ± 0.17 | 0.99 ± 0.02 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| − Fisher/Bonferroni | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.46 ± 0.12 |
| − generalisation | 1.00 ± 0.00 | 0.80 ± 0.17 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.45 ± 0.11 |
| − sequential coverage | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.56 ± 0.02 | 0.04 ± 0.01 |
| − cause split | 0.48 ± 0.07 | 1.00 ± 0.00 | 0.98 ± 0.02 | 0.83 ± 0.21 | 0.52 ± 0.01 |
| *Baseline: error summary* | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.51 ± 0.02 | 1.00 ± 0.00 | 0.30 ± 0.02 |
| *Baseline: single tree* | 0.44 ± 0.02 | 1.00 ± 0.00 | 0.97 ± 0.00 | 0.56 ± 0.02 | 0.04 ± 0.01 |

Development seeds, full pipeline vs. the two baselines (`results_final_dev/`), for comparison:

| Seeds | Variant | F3 recall | F5 recall | F6 recall | spurious |
|---|---|---|---|---|---|
| development | Full pipeline | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.14 ± 0.02 | 0.0 ± 0.0 |
| development | Error summary | 0.68 ± 0.01 | 0.62 ± 0.02 | 0.50 ± 0.02 | 2.2 ± 0.4 |
| development | Single tree | 1.00 ± 0.00 | 0.07 ± 0.01 | 0.12 ± 0.03 | 0.0 ± 0.0 |
| held-out | Full pipeline | 0.86 ± 0.17 | 1.00 ± 0.00 | 0.15 ± 0.07 | 0.2 ± 0.4 |

**Reading the results.**

* *Against the baselines.* The error summary handles errors (F1, F2) but cannot separate silent failures: F3 and F5 end up in one group, giving recall 0.67/0.64 at purity 0.51/0.30, and it includes about half of the noise (F6 recall 0.48). The single tree matches the full pipeline on easy modes but misses F5 almost completely (recall 0.07): the confounded failure is not the largest split, and without removing explained failures it is never reached.
* *Sequential coverage* recovers F5 (0.07 → 1.00 recall) and F4 (0.80 → 1.00).
* *Generalisation* matters for the silent failures: without it F3 recall is 0.62 and F5 0.91.
* *The entity feature* matters for F3 (recall 0.66 without it): "compares two cities" is visible in the request, not in the steps.
* *Goal clusters have a mixed effect, and the held-out seeds change the picture.* They are what makes F1 pure (0.44 → 1.00) and they cut spurious findings (0.8 → 0.2). But with clusters F3 recall falls to 0.86 ± 0.17 (seeds 29 and 41: 0.65 and 0.67; without clusters 1.00 in all five), F2 purity is lower (0.80 vs 1.00), and F5 purity is lower (0.46 vs 0.52; 0.23 in seed 41). On the development seeds the F3 recall cost did not appear, which is a reminder of how little five seeds from one generator establish.
* *The exact test with correction shows no effect on held-out seeds* (identical to the full pipeline). On development seeds it removes spurious findings (1.0 → 0.0 and F6 recall 0.24 → 0.14), but those seeds are where the correction was tuned (Section 7.2), so we do not count that as evidence.
* *The cause split has a cost:* removing it gives fewer findings and no spurious ones, but F1 purity falls to 0.48 and F1 recall to 0.95. We keep the split for interpretability (a finding names a failing step and error).
* *F5 purity is capped at about 0.5* in every variant: only about half of the Spanish/`model_b` traces fail and nothing in steps or context says which. This is a property of the data, not of the search.

### 6.5 Results: outcome estimation

Held-out seeds (the development seeds give the same numbers within ±0.01):

| Signals used | Precision | Recall | F1 | Recall on silent failures (F3, F5) |
|---|---|---|---|---|
| error only | 0.84 ± 0.00 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.06 ± 0.01 |
| error + loop | 0.84 ± 0.00 | 0.46 ± 0.01 | 0.59 ± 0.01 | 0.06 ± 0.01 |
| error + loop + evaluator | 0.87 ± 0.00 | 0.85 ± 0.01 | 0.86 ± 0.00 | 0.72 ± 0.01 |
| error + loop + feedback | 0.87 ± 0.01 | 0.74 ± 0.02 | 0.80 ± 0.01 | 0.57 ± 0.02 |
| all signals (as shipped) | 0.87 ± 0.01 | 0.85 ± 0.01 | 0.86 ± 0.01 | 0.72 ± 0.01 |

Error spans alone find under half of the failures and 6 % of the silent ones; adding evaluator scores nearly doubles recall. In this data, **user feedback adds nothing once an evaluator is present** (rows 3 and 5 are identical), while without an evaluator it still recovers 57 % of silent failures. The loop signal adds nothing here because the only looping mode (F2) already carries an error span. The first claim depends on how we generated the signals (Section 8) and should not be generalised.

### 6.6 Results: confirmation on reserved episodes

Full pipeline, three modes: exploratory (`f = 0`), `f = 0.3` and `f = 0.5`. The development seeds are those of 6.1; the **fresh seeds** (43, 47, 53, 59, 61) were fixed before running this experiment and were not used for any earlier decision. Mean ± std over seeds.

| Seeds | Variant | F3 recall | F4 recall | F5 recall | F6 recall | findings | spurious | rules rejected |
|---|---|---|---|---|---|---|---|---|
| development | exploratory | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.14 ± 0.02 | 6.2 ± 0.4 | 0.0 | 0 |
| development | f = 0.3 | 1.00 ± 0.00 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.14 ± 0.02 | 6.0 ± 0.0 | 0.0 | 0 |
| development | f = 0.5 | 0.92 ± 0.15 | 0.93 ± 0.09 | 1.00 ± 0.00 | 0.13 ± 0.03 | 6.2 ± 0.8 | 0.2 ± 0.4 | 0 |
| fresh | exploratory | 0.93 ± 0.13 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.12 ± 0.03 | 6.4 ± 0.5 | 0.0 | 0 |
| fresh | f = 0.3 | 0.90 ± 0.21 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.12 ± 0.03 | 6.4 ± 0.5 | 0.0 | 0 |
| fresh | f = 0.5 | 0.90 ± 0.20 | 1.00 ± 0.00 | 1.00 ± 0.00 | 0.14 ± 0.01 | 6.4 ± 0.8 | 0.0 | 0 |

Every rule proposed by the search was confirmed on the reserved episodes in all ten seeds (62 confirmed findings at `f = 0.3`; the rule the tree proposed, before generalisation, was also confirmed in every case). So in this data the findings replicate outside the search set, with no recall cost at `f = 0.3`; at `f = 0.5` the smaller search set costs recall for F3 and F4 on some development seeds. The confirmation step **rejected nothing**: the seeded effects are strong, so this result shows absence of overfitting to the search set, not that the step removes noise. Raw numbers: `results_validation_dev/`, `results_validation_test/`.

## 7. Failure analysis and mitigations

### 7.1 A robustness defect found by adding seeds (v1 → v2)

**v1 (as first shipped).** In seeds 17 and 19 the best finding for F3 had recall 1.00 but purity ≈ 0.10, and F6 recall jumped to 0.95–1.00 (seeds 7, 11, 13: 0.12–0.17). In seed 17 the first finding for the silent-failure cause had the rule `goal_cluster=4 <= 0.5 AND user.lang=es <= 0.5`, with support 4,932 of 5,000 traces: a near-universal rule built from *negated* indicators.

**Cause.** The generalisation step dropped conditions while precision stayed at least 95 % of the original rule's precision, but measured on *all* episodes. There, failures of *other* causes count as negatives, which dilutes the original rule's precision (here to ≈ 0.3) until an almost universal rule looks equally precise. The search itself had used a training set that excludes those failures, so the criterion was inconsistent with how the rule had been found; and the lift and p-value reported for the finding were those of the pre-generalisation rule.

**Fix (v2).** Precision is measured on the same training set used by the search, and a condition is dropped only if the generalised rule still reaches the minimum lift (1.5). A unit test builds a case where the old criterion drops the discriminative condition. The discovery version stored in each row was bumped (1 → 2), so existing findings are recomputed.

**Effect of the fix (development seeds, full pipeline; findings / spurious):**

| Seed | F3 purity v1 → v2 | F6 recall v1 → v2 | findings / spurious v1 | findings / spurious v2 |
|---|---|---|---|---|
| 7 | 0.99 → 0.99 | 0.14 → 0.14 | 6 / 0 | 6 / 0 |
| 11 | 0.99 → 0.99 | 0.17 → 0.17 | 6 / 0 | 6 / 0 |
| 13 | 1.00 → 1.00 | 0.12 → 0.12 | 6 / 0 | 6 / 0 |
| 17 | 0.10 → 0.99 | 1.00 → 0.32 | 7 / 2 | 7 / 1 |
| 19 | 0.11 → 0.99 | 0.95 → 0.46 | 7 / 1 | 10 / 3 |
| mean | 0.64 → 1.00 | 0.47 → 0.24 | 6.4 / 0.6 | 7.0 / 0.8 |

The fix removes the near-universal rule and restores F3 purity in every development seed. It does not remove spurious findings: in seed 19 v2 reports 10 findings, three of them broad rules with lift 1.5–1.7 on the failures left after the real causes were explained (for example `prompt.version=2 <= 0.5`, support 2,500, failure rate 0.11, p ≈ 10⁻⁴), which still pass a Bonferroni threshold applied per round.

### 7.2 Mitigating residual noise: three candidates, tested on held-out seeds

We fixed three candidate mitigations and an adoption rule before looking at the held-out seeds: *adopt a mitigation only if it helps on held-out seeds without reducing the recall of the seeded failures.* (The two thresholds below were set after seeing the development-seed residual rules, so those seeds cannot validate them.)

* **Support cap**: reject a rule that covers more than 25 % of all episodes (such a rule describes context, not a recurring failure).
* **Minimum precision**: reject a rule whose cause-failure rate inside the rule, on the search's training set, is below 0.15.
* **Family-wise Bonferroni**: multiply p by the number of candidates tested in the whole pass (all rounds and causes), not only in the round.

| Seeds | Variant | F2 purity | F4 recall | F5 recall | F6 recall | findings | spurious |
|---|---|---|---|---|---|---|---|
| dev | v2 (per-round Bonferroni) | 0.77 | 1.00 | 1.00 | 0.24 ± 0.13 | 7.0 | 0.8 ± 1.2 |
| dev | + support cap | 0.77 | 1.00 | 1.00 | 0.17 ± 0.07 | 6.4 | 0.2 ± 0.4 |
| dev | + minimum precision | 1.00 | 1.00 | 1.00 | 0.14 ± 0.02 | 6.2 | 0.0 |
| dev | + family-wise Bonferroni | 0.77 | 1.00 | 1.00 | 0.14 ± 0.02 | 6.2 | 0.0 |
| held-out | v2 (per-round Bonferroni) | 0.80 | 1.00 | 1.00 | 0.15 ± 0.07 | 6.2 | 0.2 ± 0.4 |
| held-out | + support cap | 0.80 | 0.96 ± 0.09 | **0.81 ± 0.38** | 0.10 ± 0.04 | 5.8 | 0.0 |
| held-out | + minimum precision | 1.00 | 1.00 | 1.00 | 0.15 ± 0.07 | 6.4 | 0.2 ± 0.4 |
| held-out | + family-wise Bonferroni | 0.80 | 1.00 | 1.00 | 0.15 ± 0.07 | 6.2 | 0.2 ± 0.4 |

* **Support cap: rejected.** It lowers the recall of F5 (1.00 → 0.81) and F4 on held-out seeds: in some seeds a real failure covers more than a quarter of the traffic, and the cap removes its rule.
* **Minimum precision: not adopted.** On held-out seeds it improves only F2 purity (0.80 → 1.00), at a 0.02 recall cost on F2, and does not reduce noise. It is also a constant tuned to these data: silent failures seen through weak signals can have precision around 0.2 (F4 does here), so on real traces it risks discarding legitimate patterns.
* **Family-wise Bonferroni: adopted** (discovery version 3). It is the only one without a tuned constant. It removes the residual noise on development seeds (spurious 0.8 → 0.0) and is neutral on held-out seeds (same recall, purity and spurious findings). That is weak evidence of benefit, but no evidence of harm across ten seeds, and it is the statistically sound choice when many candidates are tested in one pass.

Held-out noise is already low without any mitigation (spurious 0.2, F6 recall 0.15), with one exception: seed 41 (F6 recall 0.27, F5 purity 0.23, one spurious finding), which none of the three mitigations fixes.

**Lessons.** The defect was invisible to a single-seed validation; the first ablation of the exact test was confounded by it; and the development seeds hid a cost of goal clustering that the held-out seeds showed. We now evaluate on several seeds, keep a held-out set, and re-run ablations after each change.

## 8. Limitations and threats to validity

* **Few seeds, one generator.** Five development and five held-out seeds, all from the same generator, so the variance between seeds understates the variance between real agents. Held-out seeds are 'unseen' for the method, not for the data-generating process.
* **Synthetic, single-domain data.** One simulated weather agent with two tools. The failure modes were designed by the authors, together with the generator that creates the signals. The pipeline's features (e.g. entity count, tool-order pairs) are general, but the evaluation cannot show they find *real* production failures, nor how often real failures resemble F1–F6.
* **Circularity.** The outcome weights and the signal noise model were chosen by the same team. The result that evaluators dominate feedback, for instance, follows partly from the probabilities in Section 6.1. No human validated the findings.
* **Hand-set weights and thresholds.** They are not learned and were not tuned against real labels.
* **Estimate, not truth.** Outcome precision is ≈ 0.87: about 13 % of `failed` episodes are not failures in this data. Rules explain the *estimate*, not necessarily the real failure.
* **Multiple testing and adaptivity.** In exploratory mode the tree selects candidates with the same labels the Fisher test uses, and the correction counts only the candidates that survive the lift filter, so p-values are scores, not valid confirmatory tests. The reserved-episode confirmation (5.9) addresses this over a fixed family of rules, but across agents and passes no further correction is applied, and the confirmation rejected no rule in our data, so its filtering power is untested. The exact test showed no measurable benefit (Sections 6.4, 6.6).
* **Causal reading.** Rules and findings are associations with an estimated outcome; nothing here identifies that a tool order, language or model setting causes a failure.
* **Held-out reuse.** The held-out seeds of Section 6.1 informed the decisions of Section 7.2 and the decision to keep goal clusters, so they are not a pristine test set; the seeds of Section 6.6 are.
* **Statistical power.** At least 200 episodes and 30 supporting failures are required; smaller agents get no findings.
* **Robustness.** Section 7 shows one defect found and fixed. Residual noise is low on held-out seeds except one (seed 41), which no mitigation fixed. Goal clustering lowered silent-failure recall in 2 of 5 held-out seeds. Other noise levels and base rates were not explored.
* **Baselines.** Both baselines are ours, built from the same features. We did not compare with clustering tools or LLM-based extraction on the same data.
* **Cost.** No latency or scale measurement is reported here; we only note that the job is batch and the embedding model is local.

## 9. Reproducibility

Code: `analytics/mem/mem/{episode,discovery}.py` (the code under test), `spikes/mem/gen_traces.py` (generator), `docs/research/mem-paper/experiments.py` (this evaluation). Everything is deterministic given the seeds. From the repository root, using the spike's virtual environment:

```bash
PYTHONPATH=analytics/mem:spikes/mem spikes/mem/.venv/bin/python docs/research/mem-paper/experiments.py \
    --work-dir /tmp/mem-paper-work --out-dir docs/research/mem-paper/results_final_test --seeds 23 29 31 37 41
```

Outputs, one directory per run, each with `results.json` and `results.md`: `results_final_test/` (held-out seeds, headline tables), `results_final_dev/` (development seeds), `results_mitigation_{dev,test}/` (Section 7.2, run with `--suite mitigation`), `results_v2/` (development seeds after the Section 7.1 fix, before family-wise correction) and `results/` (v1; reproduce with `git checkout 93f0849 -- analytics/mem`). Held-out seeds: `--seeds 23 29 31 37 41`. The multilingual encoder is `paraphrase-multilingual-MiniLM-L12-v2`.

## 10. Conclusion and next steps

A deterministic pipeline can turn OTel GenAI traces into episodes and into statistically filtered, human-readable failure rules, and on seeded data it beats an error-summary baseline and a single decision tree, mainly through sequential coverage, rule generalisation and a request-level behavioural feature; the exact test is a theoretically motivated safeguard whose empirical benefit we could not show. Our evidence is synthetic; development exposed a robustness defect in the generalisation step, which we fixed, and held-out seeds exposed a cost of goal clustering for silent-failure recall that we did not resolve. The next steps, in order: understand and fix the clustering cost (for example by clustering only when it improves a finding, or by using clusters only as a refinement); test whether the exact test matters on other data; evaluate on real traces with human-validated failures; learn the outcome weights instead of setting them; and add a decision-level attribution (which decision caused, recovered from or wasted a run), as proposed by trajectory-learning work.

## References

* Wu, Z., Cho, S., Munoz Villalobos, C. E., King, T., Mohammed, U., Kazim, E., Perez-Ortiz, M., Bulathwela, S., Koshiyama, A. *AgentGraph: Trace-to-Graph Platform for Interactive Analysis and Robustness Testing in Agentic AI Systems.* AAAI 2026 (demo).
* Le, Q. M., Cao, O., Pham, H. Q. V., Lam, H. T., Nguyen, H. D. *TraceBrain: An Open-Source Framework for Agentic Trace Management.* 2026.
* Fang, G., Isahagian, V., Jayaram, K. R., Kumar, R., Muthusamy, V., Oum, P., Thomas, G. *Trajectory-Informed Memory Generation for Self-Improving Agent Systems.* IBM Research technical report, 2026 (arXiv 2603.10600).
* OpenTelemetry. *Semantic Conventions for Generative AI.* https://opentelemetry.io/docs/specs/semconv/gen-ai/
* Reflexion, ExpeL, MAST, LangSmith Insights, Braintrust Topics, Arize: cited from MemTrace's design notes (`docs/archive/phase_2_design.md`); **full citations to be completed before submission.**
