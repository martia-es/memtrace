"""Configuración del asistente, leída de variables de entorno (o del `.env` del repo)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from app.knowledge.embeddings import DEFAULT_EMBEDDING_MODEL
from app.knowledge.retriever import DEFAULT_KNOWLEDGE

DEFAULT_INDEX = Path(__file__).resolve().parents[1] / ".index" / "faqs.sqlite"

# Prioridad: entorno del proceso > `.env` del propio asistente > `.env` de la raíz del repo (claves compartidas, p. ej. GOOGLE_API_KEY).
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

# `MEMTRACE_API_URL`/`MEMTRACE_API_KEY` son de un solo experimento (el del asistente del tiempo en el .env). El prompt
# `faq-system` vive en el experimento de este asistente: sus variables propias tienen prioridad para que el SDK lo encuentre.
for _own, _sdk in (("RAG_ASSISTANT_MEMTRACE_API_URL", "MEMTRACE_API_URL"), ("RAG_ASSISTANT_MEMTRACE_API_KEY", "MEMTRACE_API_KEY")):
    if os.getenv(_own):
        os.environ[_sdk] = os.environ[_own]


@dataclass(frozen=True)
class Settings:
    model: str
    company: str
    knowledge_path: Path
    retriever: str  # "embeddings" (semántico, necesita GOOGLE_API_KEY) o "bm25" (léxico, sin red)
    index_path: Path
    embedding_model: str
    min_score: float | None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model=os.getenv("RAG_ASSISTANT_MODEL", "google:gemini-2.5-flash"),
            # empresa a la que responde: con otra y su fichero de FAQs, el mismo asistente atiende a otro cliente
            company=os.getenv("RAG_ASSISTANT_COMPANY", "Iberia"),
            knowledge_path=Path(os.getenv("RAG_ASSISTANT_KNOWLEDGE", str(DEFAULT_KNOWLEDGE))),
            retriever=os.getenv("RAG_ASSISTANT_RETRIEVER", "embeddings").lower(),
            index_path=Path(os.getenv("RAG_ASSISTANT_INDEX", str(DEFAULT_INDEX))),
            embedding_model=os.getenv("RAG_ASSISTANT_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
            min_score=float(os.environ["RAG_ASSISTANT_MIN_SCORE"]) if os.getenv("RAG_ASSISTANT_MIN_SCORE") else None,
        )
