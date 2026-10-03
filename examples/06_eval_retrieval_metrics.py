"""Scores the RETRIEVAL step of a toy RAG agent with recall@k, MRR and hit rate (ADR-045).

Each dataset item says which documents a good retrieval must return, in its metadata:

    {"input": "capital of France?", "expectedOutput": "Paris", "metadata": {"relevant_docs": ["geo-france"]}}

While an item runs, every retriever call (`memtrace.record_retrieved_chunks`, or a LangChain retriever) is
captured, and `RecallAtK` / `MRR` / `HitRate` compare the chunk ids/sources with `relevant_docs`. An item
without `relevant_docs` gets no retrieval score (the last item below). The scores show up in
Metrics > Offline evals like any other evaluator, next to latency, tokens and cost of each item's trace.

Needs a running MemTrace stack and an agent API key (dashboard: Experiment > API keys); see
`05_eval_dataset_source_memtrace.py` for the two environment variables.

    python examples/06_eval_retrieval_metrics.py

Requires the `eval` extra: pip install -e "sdk/python[eval]"
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk", "python")))

import httpx
from dotenv import load_dotenv

import memtrace
from memtrace.eval import EvalItem, MRR, HitRate, RecallAtK, exact_match, run_experiment

load_dotenv()

API_URL = os.environ["MEMTRACE_API_URL"]
API_KEY = os.environ["MEMTRACE_API_KEY"]
DASHBOARD_URL = os.environ.get("MEMTRACE_DASHBOARD_URL", "http://localhost:5173")
EXPERIMENT_ID = API_URL.rstrip("/").rsplit("/", 1)[-1]

# A tiny knowledge base: id -> text. The retriever below is deliberately imperfect.
KNOWLEDGE_BASE = {
    "geo-france": "Paris is the capital of France.",
    "geo-spain": "Madrid is the capital of Spain.",
    "geo-italy": "Rome is the capital of Italy.",
    "math-basics": "2 + 2 equals 4.",
    "history-1": "The French Revolution began in 1789.",
}
# What the toy retriever returns for each question, in rank order.
RETRIEVAL = {
    "capital of France?": ["geo-france", "geo-italy", "history-1"],          # relevant doc at rank 1
    "capital of Spain?": ["geo-italy", "history-1", "geo-spain"],            # relevant doc at rank 3
    "capital of Portugal?": ["geo-spain", "geo-italy", "history-1"],         # relevant doc missing
    "2+2?": ["math-basics", "geo-france", "geo-spain"],                      # unlabelled below
}
ANSWERS = {"capital of France?": "Paris", "capital of Spain?": "Madrid", "2+2?": "4"}

# The HTTP API is camelCase (`expectedOutput`); `metadata` is free-form JSON.
ITEMS = [
    {"input": "capital of France?", "expectedOutput": "Paris", "metadata": {"relevant_docs": ["geo-france"]}},
    {"input": "capital of Spain?", "expectedOutput": "Madrid", "metadata": {"relevant_docs": ["geo-spain"]}},
    {"input": "capital of Portugal?", "expectedOutput": "Lisbon", "metadata": {"relevant_docs": ["geo-portugal"]}},
    {"input": "2+2?", "expectedOutput": "4"},  # no relevant_docs: not scored on retrieval
]


def create_dataset() -> str:
    headers = {"Authorization": f"Bearer {API_KEY}"}
    with httpx.Client(base_url=API_URL, headers=headers, timeout=30.0) as client:
        dataset = client.post("/datasets", json={"name": "toy-rag-retrieval"})
        dataset.raise_for_status()
        dataset_id = dataset.json()["id"]
        client.post(f"/datasets/{dataset_id}/items", json={"items": ITEMS}).raise_for_status()
    return dataset_id


# The service name must be your experiment's (Experiment > Settings), or its traces land in another experiment.
memtrace.init_tracer(service_name=os.environ.get("MEMTRACE_SERVICE_NAME", "toy-rag-agent"))


@memtrace.trace_step(name="retrieve", step_type="retriever")
def retrieve(question: str) -> list:
    documents = [{"id": doc_id, "text": KNOWLEDGE_BASE[doc_id]} for doc_id in RETRIEVAL.get(question, [])]
    memtrace.record_retrieved_chunks(documents)  # what the retrieval evaluators will score
    return documents


@memtrace.trace_step(name="toy_rag_agent", step_type="agent")
def toy_rag_agent(*, item: EvalItem) -> str:
    retrieve(item.input)
    return ANSWERS.get(item.input, "I don't know")


if __name__ == "__main__":
    dataset_id = create_dataset()
    result = run_experiment(
        data=dataset_id,
        task=toy_rag_agent,
        evaluators=[exact_match, RecallAtK(3), RecallAtK(1), MRR(), HitRate()],
        name="toy-rag-retrieval",
        base_url=API_URL,
        api_key=API_KEY,
    )
    memtrace.flush()

    for summary in result.summary():
        value = summary.pass_rate if summary.pass_rate is not None else summary.average
        print(f"{summary.name:<14} {value:.2f}  (over {summary.count} items)")
    print(f"\nSee the run and Metrics > Offline evals: {DASHBOARD_URL}/e/{EXPERIMENT_ID}/datasets/{dataset_id}")
