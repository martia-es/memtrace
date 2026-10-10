"""Configuración del asistente, leída de variables de entorno (o del `.env` del repo)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from app.knowledge.retriever import DEFAULT_KNOWLEDGE

# Carga el .env de la raíz del repo (si existe) sin sobrescribir variables ya definidas.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    model: str
    company: str
    knowledge_path: Path

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model=os.getenv("RAG_ASSISTANT_MODEL", "google:gemini-2.5-flash"),
            # empresa a la que responde: con otra y su fichero de FAQs, el mismo asistente atiende a otro cliente
            company=os.getenv("RAG_ASSISTANT_COMPANY", "Iberia"),
            knowledge_path=Path(os.getenv("RAG_ASSISTANT_KNOWLEDGE", str(DEFAULT_KNOWLEDGE))),
        )
