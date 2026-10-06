# Asistente del tiempo

Asistente virtual hecho con Pydantic AI, expuesto por una API (FastAPI) y una UI web. Responde preguntas sobre el tiempo consultando [Open-Meteo](https://open-meteo.com/).

## Estructura

```
app/
  main.py                 # FastAPI + lifespan (crea agente, servicios y sesiones)
  config.py               # Variables de entorno
  agents/                 # Construcción del agente y dependencias (AssistantDeps)
  guardrails/             # Guardarraíl de entrada (input.py)
  capabilities/           # Una capability por dominio (base.py, weather.py, uv_pollen.py, air_quality.py, registry.py)
  mcp_servers/            # Servidor MCP de calidad del aire (lo consume capabilities/air_quality.py)
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

Variables opcionales: `WEATHER_ASSISTANT_MODEL`, `WEATHER_ASSISTANT_HTTP_TIMEOUT`, `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`, `OPEN_METEO_AIR_QUALITY_URL`.

## Guardarraíl de entrada

Antes de llamar al agente, `POST /api/chat` pasa el mensaje por tres comprobaciones deterministas (`app/guardrails/input.py`): longitud (más de 1000 caracteres), datos personales (correo, teléfono, tarjeta, DNI/NIE) e intento de inyección de prompt (español e inglés). Si una bloquea, el agente no ve el mensaje, no se guarda en el historial y la respuesta lleva `"blocked": true` con una explicación breve.

Con trazas activas, el turno es un solo span (`conversation_turn`) y cada comprobación cuelga de él como `guardrail.length`, `guardrail.pii` y `guardrail.prompt_injection`, dentro de `input_guardrail` (sin guardar el mensaje, que puede traer datos personales). Cuando una bloquea se abre además un span `guardrail.blocked` con el atributo `guardrail.check`: en Métricas, un gráfico de barras de ese tipo de span agrupado por `guardrail.check` muestra qué comprobación bloquea más. Las evaluaciones llaman al agente directamente, sin pasar por el guardarraíl.

## Servidor MCP

La calidad del aire (`get_air_quality`) la sirve un servidor MCP, no una función local: así el asistente tiene una conexión MCP real que MemTrace detecta (ADR-056). Por defecto el asistente arranca el servidor del repo por stdio; con `AIR_QUALITY_MCP_URL` usa uno ya en marcha:

```bash
uv run python -m app.mcp_servers.air_quality --http --port 8765
AIR_QUALITY_MCP_URL=http://127.0.0.1:8765/mcp uv run uvicorn app.main:app
```

Con trazas activas, el span de cada llamada lleva `memtrace.mcp_server=air-quality-mcp` y el servidor aparece en la pestaña *Connections* del asistente. El conjunto de evaluación no incluye esta capability (`ALL_CAPABILITIES`), así que sus cifras no cambian.

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
