# Asistente del tiempo

Asistente virtual hecho con Pydantic AI, expuesto por una API (FastAPI) y una UI web. Responde preguntas sobre el tiempo consultando [Open-Meteo](https://open-meteo.com/).

## Estructura

```
app/
  main.py                 # FastAPI + lifespan (crea agente, servicios y sesiones)
  config.py               # Variables de entorno
  agents/                 # Construcción del agente y dependencias (AssistantDeps)
  capabilities/           # Una capability por dominio (base.py, weather.py, registry.py)
  services/               # Clientes de APIs externas (weather_service.py)
  api/                    # Rutas y schemas HTTP
  sessions.py             # Historial de conversación por sesión
static/index.html         # UI de chat
tests/                    # Tests de tools y del agente (sin red ni LLM)
```

Para añadir una capacidad: crea `app/capabilities/<dominio>.py` con una `Capability` y regístrala en `app/capabilities/registry.py`.

## Ejecutar

Requiere `GOOGLE_API_KEY` en el `.env` de la raíz del repo (o en el entorno).

```bash
cd weather_assistant
uv sync --all-groups
uv run uvicorn app.main:app --reload
```

Abre http://localhost:8000 para la UI.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Body `{"message": "...", "session_id": "opcional"}`. Devuelve `{"session_id", "reply"}` |
| `DELETE` | `/api/sessions/{session_id}` | Borra el historial de una sesión |
| `GET` | `/api/capabilities` | Lista las capabilities activas |

Variables opcionales: `WEATHER_ASSISTANT_MODEL`, `WEATHER_ASSISTANT_HTTP_TIMEOUT`, `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`.

## Tests

```bash
uv run pytest
```

Decisión de arquitectura: [ADR-047](../docs/adrs/assistant/adr-047-weather-assistant-architecture.md).
