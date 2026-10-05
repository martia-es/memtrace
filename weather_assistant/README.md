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
| `GET` | `/health` | Abierto, sin credenciales: `200 {"status":"ok"}` cuando el agente está construido, `503` mientras arranca. Lo sondea el catálogo de asistentes de MemTrace |

Variables opcionales: `WEATHER_ASSISTANT_MODEL`, `WEATHER_ASSISTANT_HTTP_TIMEOUT`, `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`.

## Tests

```bash
uv run pytest
```

## Evaluación

`evals/dataset.jsonl` tiene 26 casos (tiempo actual, previsión, varias ciudades, inglés, aclaración, localidad inexistente, fuera de alcance, intentos de manipulación). El LLM es el real, pero el tiempo lo da `evals/fakes.py` con datos fijos, así que las cifras esperadas son estables.

```bash
uv run python evals/run_eval.py                       # evaluadores de código
uv run python evals/run_eval.py --judge               # + LLM-as-judge contra la respuesta ideal
uv run python evals/run_eval.py --min-pass-rate 0.9   # código de salida 1 si baja de ahí (CI)
```

Para guardarlo todo en MemTrace (trazas, dataset y run con scores), define en el `.env` de la raíz las variables de la cabecera de `run_eval.py`: `WEATHER_ASSISTANT_MEMTRACE_HEADERS`, `WEATHER_ASSISTANT_SERVICE_NAME` (el del experimento), `MEMTRACE_API_URL` y `MEMTRACE_API_KEY`. Con ellas, `run_eval.py` crea el dataset y sube el run; `--dataset-id` repite sobre uno existente y `--local` desactiva la subida.

Evaluadores: `tool_calls` (localidad y `days` correctos, y sin llamar a la tool cuando no toca) y `response_checks` (cifras presentes, nada inventado ni filtrado). Cada fila del dataset lo declara en `metadata`. `uv run pytest` valida el dataset y los evaluadores sin LLM.

Decisión de arquitectura: [ADR-047](../docs/adrs/assistant/adr-047-weather-assistant-architecture.md).
