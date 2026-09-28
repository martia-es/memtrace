"""Wrapper de BERTopic: fit inicial (manual, ver README) y transform incremental (ADR-022)."""

from __future__ import annotations

from pathlib import Path

from bertopic import BERTopic
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
MODEL_VERSION = "bertopic-v1"


class TopicModel:
    def __init__(self, bertopic_model: BERTopic) -> None:
        self._model = bertopic_model

    @classmethod
    def fit(cls, texts: list[str]) -> "TopicModel":
        """Entrena un modelo nuevo desde cero. Se llama a mano, no desde el CronJob (ADR-022)."""
        embedder = SentenceTransformer(EMBEDDING_MODEL)
        model = BERTopic(embedding_model=embedder, calculate_probabilities=True)
        model.fit(texts)
        return cls(model)

    @classmethod
    def load(cls, path: Path) -> "TopicModel":
        return cls(BERTopic.load(str(path)))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._model.save(str(path), serialization="pickle")

    def transform(self, texts: list[str]) -> list[tuple[str, float]]:
        """Asigna cada texto a un tema ya existente. Devuelve (nombre_del_tema, confianza)."""
        topic_ids, probabilities = self._model.transform(texts)
        names = self._model.get_topic_info().set_index("Topic")["Name"].to_dict()
        results = []
        for topic_id, prob in zip(topic_ids, probabilities):
            name = names.get(topic_id, "outlier") if topic_id != -1 else "outlier"
            confidence = float(prob) if prob is not None else 0.0
            results.append((name, confidence))
        return results
