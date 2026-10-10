"""Índice vectorial y recuperación semántica, con un embedder falso (sin red ni claves)."""

import hashlib

import numpy as np

from app.knowledge.embeddings import normalize
from app.knowledge.retriever import FaqEntry, load_entries
from app.knowledge.vector_retriever import VectorRetriever
from app.knowledge.vector_store import SqliteVectorStore

DIM = 64


class FakeEmbedder:
    """Bolsa de palabras con hashing: textos que comparten palabras se parecen. Cuenta las llamadas."""

    model = "fake"

    def __init__(self) -> None:
        self.documents_embedded = 0

    def _vector(self, text: str) -> np.ndarray:
        vector = np.zeros(DIM, dtype=np.float32)
        for word in text.casefold().split():
            vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 1
        return normalize(vector)

    def embed_documents(self, texts):
        self.documents_embedded += len(texts)
        return np.stack([self._vector(t) for t in texts])

    def embed_query(self, text):
        return self._vector(text)


def faq(id_: str, text: str) -> FaqEntry:
    return FaqEntry(id=id_, title=id_, category="x", text=text)


ENTRIES = [faq("maletas", "maleta equipaje peso kilos"), faq("mascotas", "perro gato mascota cabina")]


def test_store_ranks_by_cosine_and_survives_reopening(tmp_path):
    path = tmp_path / "index.sqlite"
    store = SqliteVectorStore(path)
    store.upsert([("a", "1", normalize(np.array([1, 0]))), ("b", "1", normalize(np.array([0, 1])))])
    reopened = SqliteVectorStore(path)
    assert [id_ for id_, _ in reopened.search(normalize(np.array([0.9, 0.1])), 2)] == ["a", "b"]
    assert reopened.fingerprints() == {"a": "1", "b": "1"}


def test_search_finds_the_closest_entry_and_flags_relevance():
    retriever = VectorRetriever(ENTRIES, FakeEmbedder(), SqliteVectorStore(":memory:"), min_score=0.3)
    best = retriever.search("peso de la maleta", top_k=2)[0]
    assert best.entry.id == "maletas" and best.relevant
    assert not retriever.search("receta de paella", top_k=1)[0].relevant


def test_sync_only_embeds_what_changed(tmp_path):
    embedder, store = FakeEmbedder(), SqliteVectorStore(tmp_path / "i.sqlite")
    retriever = VectorRetriever(ENTRIES, embedder, store)
    assert embedder.documents_embedded == 2
    retriever.sync(ENTRIES)
    assert embedder.documents_embedded == 2  # nada que recalcular
    retriever.sync([ENTRIES[0], faq("mascotas", "perro con otro texto")])
    assert embedder.documents_embedded == 3  # solo la modificada
    retriever.sync([ENTRIES[0]])
    assert set(store.fingerprints()) == {"maletas"}  # la retirada del fichero sale del índice


def test_blank_query_returns_nothing():
    assert VectorRetriever(ENTRIES, FakeEmbedder(), SqliteVectorStore(":memory:")).search("  ") == []


def test_real_faqs_index_one_vector_each():
    entries = load_entries()
    store = SqliteVectorStore(":memory:")
    VectorRetriever(entries, FakeEmbedder(), store)
    assert len(store) == len(entries)
