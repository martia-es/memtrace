# ADR-029: LLM-as-Judge Evaluators

* **Status**: Accepted
* **Date**: 2026-09-30
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-028 shipped the offline-evaluation harness (`run_experiment`, the `Evaluator` protocol) with two code-based built-in evaluators, `exact_match` and `contains`. Both only work when the expected output matches the actual output as a string — useless for open-ended agent responses ("did this summary capture the key points?", "is this answer grounded in the retrieved context, with no hallucination?"). Answering those needs an evaluator that itself calls an LLM to judge the output, a pattern every comparable tool (Langfuse, MLflow, Ragas) ships as `LLM-as-judge`.

The constraint from ADR-028 still applies: the SDK's evaluation module must stay decoupled from any single vendor. Adding LLM-as-judge must not hard-code a specific model provider into the evaluators themselves.

## Decision Outcome

1. **A new port, `LLMClient`** (`application/eval_ports.py`), deliberately minimal — one method, `complete(*, system, prompt, model=None) -> str`. Any chat-completion-style SDK (Anthropic, OpenAI, a self-hosted model via an OpenAI-compatible endpoint, litellm) can implement it in a few lines. Judges are written against this protocol, never against a vendor SDK directly — same boundary `DatasetSource`/`ResultsSink` already draw around MemTrace's own API (ADR-028).

2. **A shared base class, `LLMJudgeEvaluator`** (`application/judges/base.py`), implementing the `Evaluator` protocol once for every judge: it builds a prompt via the abstract `build_prompt()`, calls the injected `LLMClient`, parses a `{"score": bool, "reasoning": str}` JSON reply, and returns a `Score(source="llm_judge")`. A concrete metric only supplies `name` and `build_prompt()` — it never touches the LLM client, JSON parsing, or `Score` construction directly. This is why these evaluators live in `application/`, not as plain callables in the `memtrace.eval` facade like `exact_match`: they have a real dependency (an LLM call), so they belong behind the hexagon's port like every other adapter-backed piece of the SDK (ADR-006, ADR-024, ADR-028).

3. **Each metric is its own file under `application/judges/`** (`correctness.py`, `faithfulness.py`), one class per file — the same convention already used for the LangChain adapter (`adapters/inbound/langchain/{auto,callback,mapping}.py`), so the set of judges stays easy to scan and extend without one file growing unbounded. A package `__init__.py` re-exports the public classes; the root-level facade module `memtrace.eval_judges` (mirroring `memtrace.eval`'s own facade pattern) re-exports from there for the public API:
   - `Correctness`: is `output` semantically equivalent to `expected_output`, regardless of wording — the free-form-answer counterpart to `exact_match`.
   - `Faithfulness`: is every claim in `output` supported by a source context, with no invented facts. Needs `metadata={"context": ...}` on the `EvalItem`; raises a clear `ValueError` if it's missing rather than silently judging against nothing.

   Further metrics (e.g. `Relevance`, `Toxicity`) are added the same way: a new file under `application/judges/` subclassing `LLMJudgeEvaluator`, re-exported from `application/judges/__init__.py` and `memtrace/eval_judges.py`. No change to the base class or the runner is needed.

4. **`Evaluator`'s signature grows a `metadata` parameter.** `experiment_runner._run_item` now passes `item.metadata` alongside `input`/`output`/`expected_output`/`trace_id` to every evaluator (still keyword-filtered per evaluator, per ADR-028's existing "only declare what you need" convention) — needed for `Faithfulness` to receive a grounding context that isn't `expected_output`. Backward compatible: an evaluator that doesn't declare `metadata` never receives it.

5. **A default adapter, `AnthropicJudgeClient`** (`adapters/outbound/llm/anthropic_client.py`), implements `LLMClient` against the Anthropic API, gated behind a new `eval-judges` extra (`pip install "memtrace-ai[eval-judges]"`). Optional: a user can pass any other `LLMClient` implementation (their own OpenAI wrapper, a mock for tests) and never import this module.

## Consequences

- **Cost and latency**: unlike `exact_match`/`contains`, these evaluators make a real LLM call per item per judge. `run_experiment`'s existing `max_workers` thread pool parallelizes this the same way it does for `task`; no new infrastructure needed, but users should expect judged runs to cost money and take longer.
- **Non-determinism**: LLM judges can disagree with themselves across runs. This is accepted as inherent to the technique (every comparable tool has the same property), not something MemTrace tries to eliminate.
- **`Score.source == "llm_judge"`** (already part of `ScoreDataType`/`ScoreSource` in `domain/evaluation.py` since ADR-028) is what the dashboard uses to visually distinguish a judge's verdict from a code-based or human one — no schema change needed on the ClickHouse `scores` table.
- **Superseded in part by [ADR-043](adr-043-record-judge-identity-on-scores.md)**: `scores` now also stores the judge's model and a rubric fingerprint, so "no schema change needed" no longer holds.
- Human-in-the-loop annotation (`source="human"`) remains out of scope here, unchanged from ADR-028 / roadmap Fase 1.75.
