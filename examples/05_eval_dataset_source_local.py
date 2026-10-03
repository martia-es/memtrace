"""Evaluates a toy agent against a dataset stored in a LOCAL file. No MemTrace stack, no network.

Compare with `05_eval_dataset_source_memtrace.py`, which reads the same kind of dataset (and a pinned
version of it) from MemTrace's API.

    python examples/05_eval_dataset_source_local.py

The file is `examples/data/toy_dataset.jsonl`: one `{"input", "expected_output"?, "metadata"?}`
JSON object per line (a `.json` file holding a list of them works too). Note the snake_case
`expected_output`: that's the SDK's own shape; MemTrace's HTTP API uses camelCase.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

from memtrace.eval import EvalItem, contains, exact_match, run_experiment

DATASET_FILE = Path(__file__).parent / "data" / "toy_dataset.jsonl"


def toy_agent(*, item: EvalItem) -> str:
    # A deliberately imperfect agent: gets everything right except Spain's capital.
    answers = {"2+2?": "4", "capital of France?": "Paris", "capital of Spain?": "Barcelona"}
    return answers.get(item.input, "I don't know")


if __name__ == "__main__":
    result = run_experiment(
        data=DATASET_FILE,  # a pathlib.Path -> local file. (A plain str would be a MemTrace dataset id.)
        task=toy_agent,
        evaluators=[exact_match, contains],
        name="toy-agent-local",
        sink=None,  # keep the result in memory; nothing is uploaded anywhere
    )

    for item_result in result.items:
        scores = ", ".join(f"{s.name}={s.value}" for s in item_result.scores)
        print(f"{item_result.item.input!r:35} -> {item_result.output!r:12} [{scores}]")

    # Aggregates are computed locally too, and the file's content fingerprint identifies its "version".
    print(f"\ndataset version: {result.dataset_version}  errors: {result.error_count}")
    for s in result.summary():
        print(f"  {s.name}: pass_rate={s.pass_rate} (n={s.count})")
