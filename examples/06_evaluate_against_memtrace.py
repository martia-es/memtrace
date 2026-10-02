"""Runs a real offline evaluation against MemTrace: creates a dataset, evaluates a toy agent
against it, and prints the dashboard URL to see the scores (ADR-028, roadmap Fase 1.75).

Needs a running MemTrace stack and an agent API key for the experiment you want to use
(create one from the dashboard: Experiment > API keys). `MEMTRACE_API_URL` must include the
experiment id, since the API is multi-tenant (ADR-013) — the same convention already used for
`MEMTRACE_OTLP_ENDPOINT`.

    MEMTRACE_API_URL=http://localhost:3001/api/v1/experiments/<experimentId> \\
    MEMTRACE_API_KEY=mtk_... \\
    python examples/06_evaluate_against_memtrace.py

Requires the `eval` extra: pip install -e "sdk/python[eval]"
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

import httpx

import memtrace
from memtrace.adapters.outbound.http.eval_api_client import MemTraceResultsSink
from memtrace.eval import EvalItem, contains, exact_match, run_experiment

API_URL = os.environ["MEMTRACE_API_URL"]
API_KEY = os.environ["MEMTRACE_API_KEY"]
DASHBOARD_URL = os.environ.get("MEMTRACE_DASHBOARD_URL", "http://localhost:5173")
EXPERIMENT_ID = API_URL.rstrip("/").rsplit("/", 1)[-1]

# Note: the query API's JSON contract is camelCase (`expectedOutput`), unlike the snake_case
# `expected_output` the SDK's own local-dict shorthand for `run_experiment(data=[...])` uses —
# this script talks to the API directly (there's no "create dataset" UI yet), so it uses the
# API's own key names here.
DATASET_ITEMS = [
    {"input": "2+2?", "expectedOutput": "4"},
    {"input": "capital of France?", "expectedOutput": "Paris"},
    {"input": "capital of Spain?", "expectedOutput": "Madrid"},
]


def create_dataset() -> str:
    """The dashboard has no "create dataset" UI yet, so the script does it directly over HTTP."""
    headers = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=API_URL, headers=headers, timeout=30.0) as client:
        dataset = client.post("/datasets", json={"name": "toy-agent-smoke-test"})
        dataset.raise_for_status()
        dataset_id = dataset.json()["id"]
        items = client.post(f"/datasets/{dataset_id}/items", json={"items": DATASET_ITEMS})
        items.raise_for_status()
    return dataset_id


memtrace.init_tracer(service_name="toy-agent")  # must match the API key's experiment


@memtrace.trace_step(name="toy_agent", step_type="agent")
def toy_agent(*, item: EvalItem) -> str:
    # A deliberately imperfect agent: gets everything right except capitals.
    answers = {"2+2?": "4", "capital of France?": "Paris", "capital of Spain?": "Barcelona"}
    return answers.get(item.input, "I don't know")


if __name__ == "__main__":
    dataset_id = create_dataset()
    print(f"Dataset created: {dataset_id}")

    sink = MemTraceResultsSink(dataset_id, base_url=API_URL, api_key=API_KEY)
    result = run_experiment(data=dataset_id, task=toy_agent, evaluators=[exact_match, contains], name="toy-agent-v1", sink=sink, base_url=API_URL, api_key=API_KEY)
    memtrace.flush()

    for item_result in result.items:
        scores = ", ".join(f"{s.name}={s.value}" for s in item_result.scores)
        print(f"{item_result.item.input!r:35} -> {item_result.output!r:12} [{scores}]")

    print(f"\nSee it in the dashboard: {DASHBOARD_URL}/e/{EXPERIMENT_ID}/datasets/{dataset_id}/runs/{sink.last_run_id}")
