"""Dependencias inyectadas en cada ejecución del agente (`RunContext.deps`)."""

from dataclasses import dataclass

from app.knowledge.retriever import Retriever


@dataclass
class AssistantDeps:
    retriever: Retriever
