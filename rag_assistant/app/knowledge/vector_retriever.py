"""Recuperación semántica: embeddings de las FAQs en una base vectorial local + similitud coseno."""

import hashlib
import logging

from app.knowledge.embeddings import Embedder
from app.knowledge.retriever import FaqEntry, Hit
from app.knowledge.vector_store import SqliteVectorStore

logger = logging.getLogger(__name__)

# Similitud coseno mínima para considerar relevante un fragmento. Con gemini-embedding-001 lo relevante queda por encima
# de ~0.67 y lo ajeno por debajo de ~0.55 (medido con las FAQs de ejemplo); se puede afinar con `RAG_ASSISTANT_MIN_SCORE` y las métricas de la evaluación.
DEFAULT_MIN_SCORE = 0.6


def document_text(entry: FaqEntry) -> str:
    """Lo que se embebe de cada FAQ. Las `keywords` ya no hacen falta para encontrarla, pero ayudan con jerga y siglas."""
    return f"{entry.title}\n{entry.text}\n{entry.keywords}".strip()


def fingerprint(entry: FaqEntry, model: str) -> str:
    return hashlib.sha256(f"{model}\n{document_text(entry)}".encode()).hexdigest()


class VectorRetriever:
    def __init__(self, entries: list[FaqEntry], embedder: Embedder, store: SqliteVectorStore, *, min_score: float = DEFAULT_MIN_SCORE) -> None:
        self._entries = {entry.id: entry for entry in entries}
        self._embedder = embedder
        self._store = store
        self._min_score = min_score
        self.sync(entries)

    def sync(self, entries: list[FaqEntry]) -> None:
        """Deja el índice igual que el fichero de FAQs, llamando al modelo solo por lo nuevo o modificado."""
        indexed = self._store.fingerprints()
        wanted = {entry.id: fingerprint(entry, self._embedder.model) for entry in entries}
        stale = [entry for entry in entries if indexed.get(entry.id) != wanted[entry.id]]
        removed = [id_ for id_ in indexed if id_ not in wanted]
        if removed:
            self._store.delete(removed)
        if stale:
            vectors = self._embedder.embed_documents([document_text(entry) for entry in stale])
            self._store.upsert([(entry.id, wanted[entry.id], vector) for entry, vector in zip(stale, vectors)])
        logger.info("Índice vectorial: %d fragmentos (%d calculados, %d retirados)", len(self._store), len(stale), len(removed))

    def search(self, query: str, top_k: int = 3) -> list[Hit]:
        if not query.strip():
            return []
        found = self._store.search(self._embedder.embed_query(query), top_k)
        return [Hit(self._entries[id_], round(score, 4), relevant=score >= self._min_score) for id_, score in found if id_ in self._entries]
