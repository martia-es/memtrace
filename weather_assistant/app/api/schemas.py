from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str | None = Field(default=None, description="Omitir para iniciar sesión nueva")
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    # el guardarraíl de entrada lo detuvo: el agente no vio el mensaje
    blocked: bool = False


class CapabilityInfo(BaseModel):
    name: str
    description: str
