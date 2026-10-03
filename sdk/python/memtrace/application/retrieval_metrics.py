"""Retrieval metrics for RAG agents (ADR-045): recall@k, MRR, hit rate.

Relevance labels live in the dataset item: `metadata["relevant_docs"]` is a list of ids/sources. A retrieved
chunk is relevant when its `id` or its `source` is in that list. Items without labels get no score (they are
not counted as zeros), so a dataset can mix labelled and unlabelled items.
"""
from typing import Any, Iterable, List, Mapping, Optional, Sequence, Set

from memtrace.domain.evaluation import Score

DEFAULT_RELEVANT_KEY = "relevant_docs"


def _keys(chunk: Mapping[str, Any]) -> Set[str]:
    return {str(chunk[k]) for k in ("id", "source") if chunk.get(k) is not None}


def _relevant_ranks(retrieved: Sequence[Mapping[str, Any]], relevant: Set[str], k: Optional[int]) -> List[int]:
    """1-based ranks (within the first `k`) of the chunks that match a label, one per distinct relevant doc."""
    found: Set[str] = set()
    ranks: List[int] = []
    for rank, chunk in enumerate(retrieved[:k] if k else retrieved, start=1):
        hit = _keys(chunk) & relevant
        new = hit - found
        if new:
            found |= new
            ranks.append(rank)
    return ranks


def recall_at_k(retrieved: Sequence[Mapping[str, Any]], relevant: Iterable[str], k: int) -> float:
    """Share of the relevant docs that appear in the first `k` retrieved chunks."""
    wanted = {str(r) for r in relevant}
    if not wanted:
        raise ValueError("recall_at_k needs at least one relevant doc")
    top = retrieved[:k]
    return len({d for c in top for d in _keys(c) & wanted}) / len(wanted)


def reciprocal_rank(retrieved: Sequence[Mapping[str, Any]], relevant: Iterable[str]) -> float:
    """1 / rank of the first relevant chunk; 0 if none was retrieved."""
    ranks = _relevant_ranks(retrieved, {str(r) for r in relevant}, None)
    return 1.0 / ranks[0] if ranks else 0.0


class _RetrievalEvaluator:
    name: str

    def __init__(self, *, relevant_key: str = DEFAULT_RELEVANT_KEY):
        self._relevant_key = relevant_key

    def _score(self, retrieved: Sequence[Mapping[str, Any]], relevant: Set[str]) -> float:
        raise NotImplementedError

    def __call__(self, *, metadata: Optional[Mapping[str, Any]] = None, retrieved_chunks: Optional[Sequence[Mapping[str, Any]]] = None) -> List[Score]:
        relevant = (metadata or {}).get(self._relevant_key)
        if not relevant:
            return []  # unlabelled item: no score rather than a misleading 0
        if isinstance(relevant, str):
            relevant = [relevant]
        value = self._score(retrieved_chunks or [], {str(r) for r in relevant})
        return [Score(name=self.name, value=value, data_type="numeric")]


class RecallAtK(_RetrievalEvaluator):
    """`recall_at_<k>`: fraction of the item's relevant docs found in the top-k retrieved chunks."""

    def __init__(self, k: int = 5, *, relevant_key: str = DEFAULT_RELEVANT_KEY):
        if k < 1:
            raise ValueError("k must be >= 1")
        super().__init__(relevant_key=relevant_key)
        self.k = k
        self.name = f"recall_at_{k}"

    def _score(self, retrieved, relevant):
        return recall_at_k(retrieved, relevant, self.k)


class MRR(_RetrievalEvaluator):
    """`mrr`: reciprocal rank of the first relevant chunk (its mean over a run is the Mean Reciprocal Rank)."""

    name = "mrr"

    def _score(self, retrieved, relevant):
        return reciprocal_rank(retrieved, relevant)


class HitRate(_RetrievalEvaluator):
    """`hit_rate`: whether at least one relevant doc was retrieved (boolean)."""

    name = "hit_rate"

    def __call__(self, *, metadata=None, retrieved_chunks=None) -> List[Score]:
        scores = super().__call__(metadata=metadata, retrieved_chunks=retrieved_chunks)
        return [Score(name=self.name, value=s.value > 0, data_type="boolean") for s in scores]

    def _score(self, retrieved, relevant):
        return 1.0 if _relevant_ranks(retrieved, relevant, None) else 0.0
