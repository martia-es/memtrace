import pytest

from memtrace.application.retrieval_capture import note_retrieved, retrieval_scope
from memtrace.application.retrieval_metrics import recall_at_k, reciprocal_rank
from memtrace.eval import MRR, HitRate, RecallAtK, run_experiment

CHUNKS = [{"text": "a", "id": "d1"}, {"text": "b", "source": "kb/x.md"}, {"text": "c", "id": "d3"}]


def test_recall_at_k_counts_distinct_relevant_docs_in_the_top_k():
    assert recall_at_k(CHUNKS, ["d1", "d3"], k=2) == 0.5
    assert recall_at_k(CHUNKS, ["d1", "d3"], k=3) == 1.0
    assert recall_at_k(CHUNKS, ["kb/x.md"], k=1) == 0.0  # matches by source, but only at rank 2


def test_reciprocal_rank_is_one_over_the_first_relevant_rank_or_zero():
    assert reciprocal_rank(CHUNKS, ["d3"]) == pytest.approx(1 / 3)
    assert reciprocal_rank(CHUNKS, ["kb/x.md", "d3"]) == 0.5
    assert reciprocal_rank(CHUNKS, ["nope"]) == 0.0


def test_evaluators_skip_items_without_labels():
    assert RecallAtK(3)(metadata=None, retrieved_chunks=CHUNKS) == []
    assert MRR()(metadata={"relevant_docs": []}, retrieved_chunks=CHUNKS) == []


def test_evaluators_emit_typed_scores_with_stable_names():
    meta = {"relevant_docs": ["d1", "d3"]}
    recall = RecallAtK(2)(metadata=meta, retrieved_chunks=CHUNKS)[0]
    assert (recall.name, recall.value, recall.data_type) == ("recall_at_2", 0.5, "numeric")
    assert MRR()(metadata=meta, retrieved_chunks=CHUNKS)[0].value == 1.0
    hit = HitRate()(metadata={"relevant_docs": "zzz"}, retrieved_chunks=CHUNKS)[0]
    assert (hit.name, hit.value, hit.data_type) == ("hit_rate", False, "boolean")
    assert HitRate()(metadata=meta, retrieved_chunks=CHUNKS)[0].value is True


def test_nothing_retrieved_scores_zero_when_labelled():
    assert RecallAtK(5)(metadata={"relevant_docs": ["d1"]}, retrieved_chunks=[])[0].value == 0.0


def test_scope_collects_only_inside_and_is_a_noop_outside():
    note_retrieved([{"text": "ignored"}])
    with retrieval_scope() as inside:
        note_retrieved([{"id": "a"}])
        note_retrieved([{"id": "b"}])
    note_retrieved([{"id": "late"}])
    assert [c["id"] for c in inside] == ["a", "b"]


def test_run_experiment_feeds_each_items_chunks_to_retrieval_evaluators():
    def task(*, item):
        note_retrieved([{"id": d} for d in item.input["docs"]])
        return "answer"

    data = [
        {"input": {"docs": ["d1", "d2"]}, "metadata": {"relevant_docs": ["d2"]}},
        {"input": {"docs": ["d9"]}, "metadata": {"relevant_docs": ["d2"]}},
        {"input": {"docs": ["d1"]}},  # unlabelled: no score
    ]
    result = run_experiment(data=data, task=task, evaluators=[RecallAtK(2), MRR()], name="rag", sink=None, max_workers=2)

    by_item = [{s.name: s.value for s in r.scores} for r in result.items]
    assert by_item == [{"recall_at_2": 1.0, "mrr": 0.5}, {"recall_at_2": 0.0, "mrr": 0.0}, {}]
