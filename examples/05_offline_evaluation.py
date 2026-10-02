"""Offline evaluation of a toy agent against a local dataset, no MemTrace backend involved.

Shows the decoupled path: `data` is a plain list (no dataset_id), `sink=None` means the
result stays in memory. Swap `data` for a dataset id string to pull from MemTrace's query
API instead (requires `pip install 'memtrace-ai[eval]'` and a MemTrace deployment).

    python examples/05_offline_evaluation.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

from memtrace.eval import EvalItem, contains, exact_match, run_experiment

DATASET = [
    {"input": "2+2?", "expected_output": "4"},
    {"input": "capital of France?", "expected_output": "Paris"},
    {"input": "capital of Spain?", "expected_output": "Madrid"},
]


def toy_agent(*, item: EvalItem) -> str:
    # A deliberately imperfect "agent": gets everything right except capitals.
    answers = {"2+2?": "4", "capital of France?": "Paris", "capital of Spain?": "Barcelona"}
    return answers.get(item.input, "I don't know")


if __name__ == "__main__":
    result = run_experiment(
        data=DATASET,
        task=toy_agent,
        evaluators=[exact_match, contains],
        name="toy-agent-v1",
        sink=None,  # keep the result in memory; never touches MemTrace
    )

    for item_result in result.items:
        scores = ", ".join(f"{s.name}={s.value}" for s in item_result.scores)
        print(f"{item_result.item.input!r:35} -> {item_result.output!r:12} [{scores}]")
