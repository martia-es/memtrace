"""Base de datos vectorial local: un fichero SQLite con un vector por fragmento y búsqueda por similitud coseno.

Es deliberadamente pequeña: con cientos o pocos miles de fragmentos, un producto matricial con numpy es exacto y tarda
microsegundos, sin servidor ni índice aproximado. Si la base de conocimiento crece, se cambia por pgvector, Qdrant, etc.
escribiendo otra clase con estos mismos métodos.
"""

import sqlite3
from pathlib import Path

import numpy as np


class SqliteVectorStore:
    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL)"
        )
        self._ids: list[str] = []
        self._matrix = np.empty((0, 0), dtype=np.float32)
        self._reload()

    def fingerprints(self) -> dict[str, str]:
        """`id -> huella` de lo ya indexado: sirve para saber qué falta por (re)calcular."""
        return dict(self._db.execute("SELECT id, fingerprint FROM vectors"))

    def upsert(self, items: list[tuple[str, str, np.ndarray]]) -> None:
        with self._db:
            self._db.executemany(
                "INSERT OR REPLACE INTO vectors (id, fingerprint, dim, vector) VALUES (?, ?, ?, ?)",
                [(id_, fingerprint, len(vector), np.asarray(vector, dtype=np.float32).tobytes()) for id_, fingerprint, vector in items],
            )
        self._reload()

    def delete(self, ids: list[str]) -> None:
        with self._db:
            self._db.executemany("DELETE FROM vectors WHERE id = ?", [(id_,) for id_ in ids])
        self._reload()

    def search(self, query: np.ndarray, top_k: int) -> list[tuple[str, float]]:
        """Los `top_k` más parecidos como `(id, similitud coseno)`; los vectores deben estar normalizados."""
        if not self._ids:
            return []
        scores = self._matrix @ np.asarray(query, dtype=np.float32)
        best = np.argsort(-scores)[:top_k]
        return [(self._ids[i], float(scores[i])) for i in best]

    def __len__(self) -> int:
        return len(self._ids)

    def _reload(self) -> None:
        rows = self._db.execute("SELECT id, vector FROM vectors ORDER BY id").fetchall()
        self._ids = [row[0] for row in rows]
        self._matrix = (
            np.stack([np.frombuffer(row[1], dtype=np.float32) for row in rows]) if rows else np.empty((0, 0), dtype=np.float32)
        )
