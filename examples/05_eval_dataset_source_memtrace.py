"""Evaluates a toy agent against a dataset stored in MemTrace, and shows how to PIN a version.

Compare with `05_eval_dataset_source_local.py`, which needs no MemTrace stack at all.

What this shows that the local example can't:
  1. the dataset lives in MemTrace and is versioned automatically every time its items change;
  2. `run_experiment(data=dataset_id)` reads the LATEST version;
  3. `run_experiment(data=dataset_id, dataset_version="2.0")` re-runs against an exact older
     version, even after the dataset has changed — and the run is recorded against that version;
  4. results show up in the dashboard (Datasets > this dataset > Runs, with the version used);
  5. because `init_tracer()` runs before `run_experiment`, every item runs in its own trace (`eval.item`)
     and its id is saved with the result: the run view shows latency, tokens and cost read from it (ADR-044).

Needs a running MemTrace stack and an agent API key (dashboard: Experiment > API keys).
`MEMTRACE_API_URL` must include the experiment id (ADR-013), like `MEMTRACE_OTLP_ENDPOINT`.
Both variables are read from `.env` (or the environment); to pass them inline instead:

    MEMTRACE_API_URL=http://localhost:3001/api/v1/experiments/<experimentId> \\
    MEMTRACE_API_KEY=mtk_... \\
    python examples/05_eval_dataset_source_memtrace.py

Requires the `eval` extra: pip install -e "sdk/python[eval]"
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

import httpx
from dotenv import load_dotenv

import memtrace
from memtrace.eval import EvalItem, exact_match, run_experiment

load_dotenv()

API_URL = os.environ["MEMTRACE_API_URL"]
API_KEY = os.environ["MEMTRACE_API_KEY"]
DASHBOARD_URL = os.environ.get("MEMTRACE_DASHBOARD_URL", "http://localhost:5173")
EXPERIMENT_ID = API_URL.rstrip("/").rsplit("/", 1)[-1]

# The HTTP API is camelCase (`expectedOutput`), unlike the SDK's local `expected_output`.
FIRST_ITEMS = [
    {"input": "2+2?", "expectedOutput": "4"},
    {"input": "capital of France?", "expectedOutput": "Paris"},
]
EXTRA_ITEMS = [{"input": "capital of Spain?", "expectedOutput": "Madrid"}]


def create_dataset_with_two_versions() -> str:
    """A new dataset starts at 1.0 (empty); every POST of items bumps the major version (ADR-032)."""
    headers = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=API_URL, headers=headers, timeout=30.0) as client:
        dataset = client.post("/datasets", json={"name": "toy-agent-versioned"})
        dataset.raise_for_status()
        dataset_id = dataset.json()["id"]
        client.post(f"/datasets/{dataset_id}/items", json={"items": FIRST_ITEMS}).raise_for_status()  # -> 2.0 (2 items)
        client.post(f"/datasets/{dataset_id}/items", json={"items": EXTRA_ITEMS}).raise_for_status()  # -> 3.0 (3 items)
    return dataset_id


memtrace.init_tracer(service_name="toy-agent")  # must match the API key's experiment


@memtrace.trace_step(name="toy_agent", step_type="agent")
def toy_agent(*, item: EvalItem) -> str:
    answers = {"2+2?": "4", "capital of France?": "Paris", "capital of Spain?": "Barcelona"}
    return answers.get(item.input, "I don't know")


if __name__ == "__main__":
    dataset_id = create_dataset_with_two_versions()
    print(f"Dataset created: {dataset_id} (versions 2.0 with 2 items, 3.0 with 3 items)\n")

    common = dict(task=toy_agent, evaluators=[exact_match], base_url=API_URL, api_key=API_KEY)

    latest = run_experiment(data=dataset_id, name="toy-agent-latest", **common)
    pinned = run_experiment(data=dataset_id, dataset_version="2.0", name="toy-agent-v2.0", **common)
    memtrace.flush()

    # `dataset_version` is the version the server actually served, and the one the run is recorded against.
    print(f"latest version ({latest.dataset_version}): {len(latest.items)} items, exact_match pass rate {latest.summary()[0].pass_rate:.2f}")
    print(f"pinned version ({pinned.dataset_version}): {len(pinned.items)} items, exact_match pass rate {pinned.summary()[0].pass_rate:.2f}  <- before 'Spain' was added")
    traced = sum(1 for r in latest.items if r.trace_id)
    print(f"items linked to a trace (latency/tokens/cost in the dashboard): {traced}/{len(latest.items)}")
    print(f"\nSee both runs, with the version each used: {DASHBOARD_URL}/e/{EXPERIMENT_ID}/datasets/{dataset_id}")
