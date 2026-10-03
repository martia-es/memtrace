"""Public entry point for LLM-as-judge evaluators (see ADR-029).

Same facade pattern as `memtrace.eval`: plug in any `LLMClient` — `memtrace.adapters.outbound.
llm.anthropic_client.AnthropicJudgeClient` is a default, optional one, but a judge written
against the `LLMClient` protocol works with any vendor. Both judges are plain `Evaluator`s,
so they drop straight into `run_experiment(evaluators=[...])` alongside `exact_match`, etc.

    from memtrace.eval import run_experiment
    from memtrace.eval_judges import Correctness
    from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient

    correctness = Correctness(client=AnthropicJudgeClient())
    result = run_experiment(data=[...], task=my_agent, evaluators=[correctness], name="v2")

Requires the `eval-judges` extra for the bundled Anthropic client: `pip install
"memtrace-ai[eval-judges]"` — not needed if you bring your own `LLMClient`.
"""
from memtrace.application.eval_ports import LLMClient, LLMReply
from memtrace.application.judges import Correctness, Faithfulness, LLMJudgeEvaluator

__all__ = ["LLMClient", "LLMReply", "LLMJudgeEvaluator", "Correctness", "Faithfulness"]
