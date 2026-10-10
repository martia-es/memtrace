from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str | None = Field(default=None, description="Omitir para iniciar sesión nueva")
    message: str = Field(min_length=1, max_length=4000)


class Source(BaseModel):
    id: str
    title: str


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    # FAQs que el agente consultó para esta respuesta (vacío si no buscó o no encontró nada)
    sources: list[Source] = []
    # el guardarraíl de entrada lo detuvo: el agente no vio el mensaje
    blocked: bool = False
    # traza MemTrace de esta respuesta: con ella el usuario puede votar 👍/👎 (None si el trazado está apagado)
    trace_id: str | None = None


class FeedbackRequest(BaseModel):
    trace_id: str = Field(pattern=r"^[0-9a-fA-F]{32}$")
    rating: Literal["up", "down"]
    # la sesión identifica a quien vota: volver a votar la misma respuesta cambia su voto en vez de duplicarlo
    session_id: str | None = Field(default=None, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)


class CapabilityInfo(BaseModel):
    name: str
    description: str
