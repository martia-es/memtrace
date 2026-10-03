"""Historial de conversación por sesión.

Implementación en memoria: válida para un solo proceso. Para escalar a varias réplicas,
basta con sustituir esta clase por una que persista en Redis o base de datos, manteniendo
los mismos métodos.
"""

import asyncio
from collections import defaultdict

from pydantic_ai.messages import ModelMessage


class SessionStore:
    def __init__(self) -> None:
        self._histories: dict[str, list[ModelMessage]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def get_history(self, session_id: str) -> list[ModelMessage]:
        async with self._lock:
            return list(self._histories.get(session_id, []))

    async def save_history(self, session_id: str, messages: list[ModelMessage]) -> None:
        async with self._lock:
            self._histories[session_id] = messages

    async def clear(self, session_id: str) -> bool:
        async with self._lock:
            return self._histories.pop(session_id, None) is not None
