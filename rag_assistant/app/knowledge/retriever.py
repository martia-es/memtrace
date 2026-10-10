"""Base de conocimiento y recuperación (la «R» de RAG).

`Retriever` es el puerto: el agente solo sabe que le dan fragmentos ordenados por relevancia. La implementación
por defecto, `Bm25Retriever`, es léxica y no necesita red ni claves, así que las pruebas y las evaluaciones son
deterministas. Para pasar a embeddings (Gemini, un almacén vectorial...) se escribe otra clase con `search()` y
se cambia en `main.py`; ni el agente ni la capability cambian.
"""

import json
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

DEFAULT_KNOWLEDGE = Path(__file__).resolve().parent / "data" / "iberia_faqs.jsonl"

# Palabras vacías mínimas (es + en): sin ellas, «de», «el» o «the» puntúan más que el contenido de la pregunta.
STOPWORDS = frozenset(
    """a al algo con cual cuales cuando cuanta cuantas cuanto cuantos de del donde el ella ellos en es esta este esto la las lo los me mi mis
    muy no o para pero por que se si sin su sus te tu tus un una uno y ya hay puedo puede pueden como
    ha he han hace hago hacer quiero quieres necesito puedes podria podrias recomendar
    a an and are can do does for from how i in is it my of on or the to what when where which with you your""".split()
)


@dataclass(frozen=True)
class FaqEntry:
    id: str
    title: str
    category: str
    text: str
    keywords: str = ""


@dataclass(frozen=True)
class Hit:
    entry: FaqEntry
    score: float
    matched: int  # cuántos términos distintos de la pregunta aparecen en el fragmento
    query_terms: int  # cuántos términos distintos tiene la pregunta (sin palabras vacías)


class Retriever(Protocol):
    def search(self, query: str, top_k: int = 3) -> list[Hit]: ...


def load_entries(path: Path = DEFAULT_KNOWLEDGE) -> list[FaqEntry]:
    entries = [FaqEntry(**json.loads(line)) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    ids = [entry.id for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError(f"ids duplicados en {path}")
    return entries


def tokenize(text: str) -> list[str]:
    """Minúsculas, sin acentos, sin palabras vacías y con un recorte de plurales muy simple."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).casefold()
    tokens = []
    for word in re.findall(r"[a-z0-9]+", folded):
        if word in STOPWORDS:
            continue
        if len(word) > 4 and word.endswith("es"):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("s"):
            word = word[:-1]
        tokens.append(word)
    return tokens


class Bm25Retriever:
    """BM25 (Okapi) sobre título + texto + palabras clave. El título pesa el doble."""

    def __init__(self, entries: list[FaqEntry], *, k1: float = 1.5, b: float = 0.75) -> None:
        self._entries = entries
        self._k1, self._b = k1, b
        self._docs = [Counter(tokenize(f"{e.title} {e.title} {e.text} {e.keywords}")) for e in entries]
        self._lengths = [sum(doc.values()) for doc in self._docs]
        self._avg_length = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0
        document_frequency: Counter[str] = Counter()
        for doc in self._docs:
            document_frequency.update(doc.keys())
        n = len(self._docs)
        self._idf = {term: math.log(1 + (n - df + 0.5) / (df + 0.5)) for term, df in document_frequency.items()}

    def search(self, query: str, top_k: int = 3) -> list[Hit]:
        terms = tokenize(query)
        distinct = set(terms)
        hits = []
        for entry, doc, length in zip(self._entries, self._docs, self._lengths):
            score = 0.0
            for term in terms:
                frequency = doc.get(term, 0)
                if frequency:
                    norm = frequency + self._k1 * (1 - self._b + self._b * length / self._avg_length)
                    score += self._idf[term] * frequency * (self._k1 + 1) / norm
            if score > 0:
                hits.append(Hit(entry, round(score, 4), sum(1 for t in distinct if t in doc), len(distinct)))
        return sorted(hits, key=lambda hit: hit.score, reverse=True)[:top_k]
