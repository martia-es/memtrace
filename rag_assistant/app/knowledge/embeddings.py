"""Embeddings: convierten texto en vectores. `Embedder` es el puerto; `GeminiEmbedder` es la implementación real.

Los vectores salen normalizados (norma 1), así que la similitud coseno es un producto escalar.
"""

import os
from typing import Protocol

import numpy as np

DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"
# gemini-embedding-001 admite recortar sus 3072 dimensiones; 768 pierde muy poca calidad y el índice pesa 4 veces menos
EMBEDDING_DIMENSIONS = 768


class Embedder(Protocol):
    model: str

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


def normalize(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


class GeminiEmbedder:
    """Embeddings de Gemini con tipo de tarea distinto para documentos y consultas (mejora la recuperación)."""

    def __init__(self, api_key: str | None = None, model: str = DEFAULT_EMBEDDING_MODEL) -> None:
        from google import genai

        # con GOOGLE_API_KEY y GEMINI_API_KEY a la vez el SDK avisa: se elige una explícitamente
        self._client = genai.Client(api_key=api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
        self.model = model

    def _embed(self, texts: list[str], task_type: str) -> np.ndarray:
        from google.genai import types

        vectors: list[list[float]] = []
        for start in range(0, len(texts), 100):  # el límite de la API es 100 textos por llamada
            response = self._client.models.embed_content(
                model=self.model,
                contents=texts[start : start + 100],
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=EMBEDDING_DIMENSIONS),
            )
            vectors.extend(embedding.values for embedding in response.embeddings)
        return normalize(np.array(vectors, dtype=np.float32))

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._embed(texts, "RETRIEVAL_DOCUMENT")

    def embed_query(self, text: str) -> np.ndarray:
        return self._embed([text], "RETRIEVAL_QUERY")[0]
