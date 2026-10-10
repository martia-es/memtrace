"""Configuración del asistente, leída de variables de entorno (o del `.env` del repo)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from app.knowledge.embeddings import DEFAULT_EMBEDDING_MODEL
from app.knowledge.retriever import DEFAULT_KNOWLEDGE

DEFAULT_INDEX = Path(__file__).resolve().parents[1] / ".index" / "faqs.sqlite"

# Carga el .env de la raíz del repo (si existe) sin sobrescribir variables ya definidas.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


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
