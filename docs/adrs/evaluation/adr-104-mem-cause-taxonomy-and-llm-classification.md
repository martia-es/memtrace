# ADR-104: Mem Cause Taxonomy and Discovery by LLM Classification, Validated on a Public Test Bench

* **Status**: Accepted. The taxonomy and the discovery method are decided; the accuracy numbers in section 5 are a baseline, not a pass: they do not yet justify applying anything without a person. Not implemented in the product (spike only, `spikes/mem/`)
* **Date**: 2026-10-31
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-100](../storage/adr-100-arcadedb-knowledge-store.md), [ADR-072](../prompts/adr-072-drafts-and-fixes-from-failures.md), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-101](../cybersecurity/adr-101-provider-keys-held-by-memtrace.md), [ADR-097](adr-097-repeated-executions-to-measure-evaluation-noise.md), [roadmap, phase 2](../../roadmap.md), [phase 2 design](../../archive/phase_2_design.md)

## Context and Problem Statement

Phase 2 (Mem) turns recurring failures into lessons. To say "this fails repeatedly" the failures must be **grouped by cause**, and a lesson is written per group. Question Q10 of the phase 2 design (a cause taxonomy for a single agent) was open, and the only catalogue that existed (the retired ADR-066, in `api/src/domain/error-categories.ts`) covers **visible infrastructure errors** (quota, timeout, credentials) matched by regex. Silent failures, where the agent answers wrongly without raising an error, had no categories.

The first spike (`spikes/mem/`) found the failures it had seeded itself (recall 0.84), which proves nothing about unknown failures, and its one causal test (does a lesson fix the failure) never finished. Three things had to be decided before building: which causes exist, how a failure gets assigned to one, and how we know the method works.

## Decision

### 1. Two-level cause model, stored as stable ids

- **Infrastructure causes** keep the ADR-066 catalogue (`quota_exceeded`, `timeout`, `access_denied`, ...). They are deterministic and need no LLM.
- **Behaviour causes** are for failures the agent causes without an exception. Eight causes plus `unclear`:

| Id | The agent... |
|---|---|
| `tool_misuse` | picks the wrong tool, calls it with wrong arguments or order, misreads its output, or writes wrong code or queries to call it |
| `bad_retrieval` | tries to obtain information and fails or goes off-target |
| `fabrication` | invents data or takes something as true without basis, including answering from memory without trying to retrieve |
| `context_loss` | forgets or ignores something already in the conversation |
| `instruction_violation` | breaks an explicit policy, role, format or scope constraint |
| `goal_drift` | drifts from the goal or plans badly: repeats steps, loops, does not replan after a failure |
| `bad_termination` | ends wrongly: answers without enough evidence, stops early or does not verify |
| `wrong_reasoning` | reasons or calculates wrongly and fits none of the above |

- The ids are a **data contract**: they are stored in `mem_episodes` and in lessons. New causes may be added; an id is never renamed or reused. The definitions and the tie-break rules live in `spikes/mem/bench_data/taxonomy.py` and move to the product with the same ids.
- **Tie-breaks**: classify by the **first** step that goes wrong, not by the final answer; `bad_retrieval` needs an attempt that fails, while answering from memory is `fabrication`; `bad_termination` only if nothing was tried or verified; `unclear` only when the text cannot decide.
- It is adapted from MAST (14 modes) and from the TRAIL categories, dropping what only exists between several agents. `bad_code` was **merged into `tool_misuse`**: the agent's code is a way of calling a tool, and neither people nor LLMs separated them reliably.
- A merge is justified only if the two causes would produce the **same lesson**; accuracy is a side effect, not the criterion. `fabrication` and `wrong_reasoning` are confused often but are kept apart because the fix differs (require evidence before answering vs. a reasoning error that a prompt rarely fixes).

### 2. Discovery classifies, it does not cluster freely

An LLM reads each failed episode, locates the **first wrong step** and classifies it into the taxonomy. Patterns are then mined **within** a cause (statistical contrast against successes, minimum support). Free semantic clustering of diagnoses is not the primary grouping.

- **Two models must agree** for a diagnosis to feed pattern mining; where they disagree the episode stays unclassified and goes to review. The models are different from the one that labelled the validation data.
- Nothing is applied without approval, as the design already requires. At the accuracy of section 5 the classification is a **proposal**, never a decision.

### 3. A public test bench with gates, kept out of the repository

- **Composition** (`spikes/mem/bench_data/`, one converter per source to a common episode format): Exgentic τ²-bench (600 episodes, 300 successes and 300 failures, for success/failure contrast), Who&When (184 failures with human step and reason), MAST (300, biased to rare modes, labels by an LLM judge) and, still to label, own traces of the weather assistant.
- **Licence and data**: only converters, ids and labels are versioned. Downloaded data lives in `data/raw/` and outputs in `out/`, both ignored by git. TRAIL (MIT, but gated: its terms forbid resharing outside a private repository) was discarded.
- **Gates** (thresholds to decide, see Open questions): annotator agreement on the taxonomy; the full pipeline must beat a cheap baseline (an LLM reading N failures and summarising); a lesson must beat a placebo lesson and not regress the control.
- **Discipline**: discovery and validation are split by trace and by group; nothing is tuned on the human-labelled test cases, only on a separate development sample.

## Considered Options

| Option | Verdict |
|---|---|
| **Fixed taxonomy + LLM classification, two-model agreement** | **Chosen** |
| Free semantic clustering of diagnoses (BERTopic-style, as in ADR-022) | Rejected as the primary grouping: on 177 human-written reasons the clusters follow the topic (Wikipedia, OCR, code), not the failure type (section 5) |
| Adopt MAST as is (14 modes) | Rejected: several modes need more than one agent (2.2, 2.4), and its labels come from an LLM judge, not people |
| Adopt the TRAIL categories | Rejected as a base: 30 categories with inconsistent spelling, and the data cannot enter the repository |
| Keep only the ADR-066 catalogue | Rejected: it cannot see silent failures, which are the ones a lesson can fix |
| A single model decides | Rejected: two different models disagree on 53 % of cases and are right far more often when they agree |

## Consequences

**Positive**

- A shared vocabulary between failures, lessons, evidence and measurement; the lesson text and the metric (recurrence per cause) hang from the same id.
- The method is checked against data we did not seed before any product code exists, and the checks are repeatable (`bench_diagnose.py`, `bench_ceiling.py`, `bench_cost.py`).
- Cost is not the constraint: diagnosing every failure of the bench is about 3 USD at the most expensive prices found (unconfirmed); the real limit was the free tier of the provider.

**Negative**

- Accuracy is low (section 5). An automatic classification would send wrong lessons to review; the gate before the product is a human in the loop and the agreement of two models.
- The labels of the bench are a mix of human steps and causes classified by an LLM from one-sentence reasons; they are a noisy truth.
- Several causes appear rarely in the data (`context_loss` and `instruction_violation` in Who&When have 3 and 2 cases), so MAST has to cover them.
- Public benchmarks are closed tasks (GAIA, SWE-bench, τ²-bench) and cannot be re-run, so they say nothing about whether a **lesson** works.

## 5. Evidence (2026-10-31)

| Check | Result |
|---|---|
| Agreement between two annotators (human and Claude), 40 blind cases of Who&When | 77.5 %, kappa 0.73. The 9 disagreements were mostly `bad_retrieval` vs `bad_termination` or `fabrication`, which produced the tie-breaks above |
| Clustering the 177 human reasons (local embeddings) | KMeans (k=9): purity 0.46, ARI 0.14 (always guessing the commonest cause gives 0.20). HDBSCAN: purity 0.75 but 84 % of the points are noise |
| LLM reads the trace, classifies the cause and the first wrong step (40 blind cases) | `gpt-oss-120b`: cause 0.40 (kappa 0.30), exact step 0.35, within one step 0.40. `qwen3.8-27b`: 0.38 (kappa 0.26), 0.33, 0.42 |
| Same, with `bad_code` merged into `tool_misuse` | 0.45 and 0.42 |
| Both models agree | 19 of 40 cases; right on the cause 0.63 and on the step 0.65 (0.29 and 0.24 when they disagree) |
| Development sample (30 other cases, no hint) | cause 0.37, step 0.27 |
| Giving the human decisive step as a hint (22 paired development cases) | cause 0.36 without, 0.32 with: 3 cases improve and 4 get worse. Locating the step is not what limits the cause accuracy; the run was cut at 22 of 30 by the provider's token limit |
| Cost of one diagnosis call per failure | Who&When 184 failures: 1.3 M tokens; MAST 200: 0.8 M; Exgentic τ² 300: 2.7 M (median 2.5 to 6.8 k tokens per episode, p90 up to 21 k) |
| Own traces of the weather assistant | 160 conversations generated with `gpt-oss-20b` (Groq free tier); not yet labelled |

The best published step accuracy on Who&When we found is below 15 %, so 0.35 is not bad for the step; for the cause it is a baseline to beat.

## Open questions

- Thresholds of the gates: minimum agreement between annotators (0.6 proposed), minimum gain of the full pipeline over the cheap baseline, minimum drop of the failure against the placebo and maximum regression in the control, and the maximum cost per diagnosed episode.
- Q6 (control group to measure recurrence) needs a power calculation before fixing 10 %; Q7 (minimum support, 30 proposed).
- Giving the decisive step did not raise the cause accuracy (section 5), so the limit looks like the fuzzy boundaries between causes and the one-sentence human reasons used as truth. Next to try: few-shot examples per cause and a labelled sample from own traces, where the reason can be checked against the trace.
- A lesson's effect (stage C) needs an agent that can be re-run, with and without the lesson, a placebo and a human fix: not covered by any public data. The RAG assistant is blocked here because its embeddings use a Gemini key.
- What to do with the cases where the two models disagree (review queue vs. a third model).
