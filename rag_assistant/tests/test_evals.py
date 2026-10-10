"""El dataset y los evaluadores de `evals/` se validan sin LLM ni red."""

import json
import sys
from pathlib import Path

import pytest

EVALS = Path(__file__).resolve().parents[1] / "evals"
sys.path.insert(0, str(EVALS))

from evaluators import check_response, mentions_number  # noqa: E402

from app.capabilities.faq import is_relevant  # noqa: E402
from app.knowledge.retriever import Bm25Retriever, load_entries  # noqa: E402

ROWS = [json.loads(line) for line in (EVALS / "dataset.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
ENTRIES = load_entries()
RETRIEVER = Bm25Retriever(ENTRIES)


def test_inputs_are_unique():
    inputs = [row["input"] for row in ROWS]
    assert len(inputs) == len(set(inputs))


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row["input"][:40])
def test_ideal_answer_passes_its_own_checks(row):
    ok, comment = check_response(row["expected_output"], row["metadata"])
    assert ok, comment


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row["input"][:40])
def test_relevant_docs_exist_and_the_retriever_finds_them(row):
    relevant = row["metadata"].get("relevant_docs", [])
    assert set(relevant) <= {entry.id for entry in ENTRIES}
    found = [hit.entry.id for hit in RETRIEVER.search(row["input"], top_k=3) if is_relevant(hit)]
    if relevant:
        assert set(relevant) <= set(found), found
    else:
        assert not found, found  # fuera de alcance: no debe llegar contexto al agente


def test_dataset_covers_answerable_and_unanswerable_questions():
    assert sum(1 for row in ROWS if row["metadata"]["expects"] == "faq") >= 10
    assert sum(1 for row in ROWS if row["metadata"]["expects"] == "none") >= 3


def test_number_matching():
    assert mentions_number("hay 10 kg", 10) and mentions_number("10,0 kg", 10)
    assert not mentions_number("110 kg", 10) and not mentions_number("1.0 kg", 10)
