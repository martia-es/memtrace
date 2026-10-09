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
| `POST` | `/api/chat` | Body `{"message": "...", "session_id": "opcional"}`. Devuelve `{"session_id", "reply", "trace_id"}`; `trace_id` es la traza de esa respuesta (`null` con el trazado apagado) |
| `POST` | `/api/chat/feedback` | Body `{"trace_id": "...", "rating": "up" \| "down", "session_id": "opcional", "comment": "opcional"}`. Guarda el 👍/👎 en MemTrace sobre esa traza (`204`); `503` si no hay `MEMTRACE_API_URL` |
| `DELETE` | `/api/sessions/{session_id}` | Borra el historial de una sesión |
| `GET` | `/api/capabilities` | Lista las capabilities activas |
| `GET` | `/health` | Abierto, sin credenciales: `200 {"status":"ok"}` cuando el agente está construido, `503` mientras arranca. Lo sondea el catálogo de asistentes de MemTrace |

Variables opcionales: `WEATHER_ASSISTANT_MODEL`, `WEATHER_ASSISTANT_HTTP_TIMEOUT`, `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`, `OPEN_METEO_AIR_QUALITY_URL`.

## Prompt desde el registro de MemTrace

Con `MEMTRACE_API_URL` (con el id del experimento) y `MEMTRACE_API_KEY`, el asistente lee sus instrucciones del prompt `weather-system` (o `WEATHER_ASSISTANT_PROMPT`) del [registro](../docs-site/platform/prompts.md): mover un tag en MemTrace cambia lo que dice, sin reiniciar, y cada traza lleva la versión que la produjo. Sin esas variables, o si el prompt aún no existe, usa su texto por defecto. `GET /api/prompt` dice cuál está usando.

`scripts/prompts_demo.py` es un recorrido guiado: crear el prompt, versionarlo, usarlo en el asistente y generar trazas (`uv run python scripts/prompts_demo.py`; el principio del fichero explica cómo arrancar el asistente). Para el playground de MemTrace («Try it») añade `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true` (solo en no producción).

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

**Feedback del usuario.** Cada respuesta del chat lleva su `trace_id` y la UI muestra 👍/👎 debajo. El voto va a `POST /api/chat/feedback`, que llama a `memtrace.feedback(...)` con `MEMTRACE_API_URL` y `MEMTRACE_API_KEY` (la clave se queda en el servidor); el `session_id` identifica a quien vota, así que cambiar de opinión sustituye el voto. Para que el panel «Talk» de MemTrace también ofrezca 👍/👎, en la ficha del agente pon *Trace id field* = `trace_id`.

Para probar el gate de despliegue sin LLM ni cuota: `uv run python evals/run_eval.py --mock` (la tarea devuelve la respuesta y las llamadas esperadas, así que todo pasa). Con `MEMTRACE_GIT_SHA=<sha>` el run queda etiquetado con ese commit y sin marca de "dirty".

Evaluadores: `tool_calls` (localidad y `days` correctos, y sin llamar a la tool cuando no toca) y `response_checks` (cifras presentes, nada inventado ni filtrado). Cada fila del dataset lo declara en `metadata`. `uv run pytest` valida el dataset y los evaluadores sin LLM.

Decisión de arquitectura: [ADR-047](../docs/adrs/assistant/adr-047-weather-assistant-architecture.md).

## Versión del código y despliegue (ADR-064, ADR-065)

Es el agente de referencia del flujo completo: cada traza y cada evaluación llevan el commit con el que se generaron, y MemTrace
solo despliega un commit que haya pasado la evaluación.

- `Dockerfile`: se construye desde la **raíz del repo** (el SDK es una dependencia local) y recibe el commit como `GIT_SHA`:
  `docker build -f weather_assistant/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t weather-assistant .`.
  El SDK lo lee y lo pone en todas las trazas (`vcs.repository.ref.revision`).
- `.github/workflows/weather-assistant-eval.yml`: en cada push/PR pasa los tests y evalúa el commit con `evals/run_eval.py`,
  subiendo el run a MemTrace (el SDK toma `GITHUB_SHA`). Variables del repo: `MEMTRACE_API_URL`, `MEMTRACE_SERVICE_NAME`,
  `MEMTRACE_DATASET_ID`; secretos: `MEMTRACE_API_KEY`, `GOOGLE_API_KEY`. Sin ellos solo corren los tests.
- `.github/workflows/weather-assistant-deploy.yml`: lo lanza el botón **Deploy** de MemTrace con `sha`, `environment` y `deploy_id`.
  Construye la imagen con ese commit. **El último paso (publicar y desplegar) falla a propósito hasta que se decida el destino**
  (k3d local o nube): terminar en verde sin desplegar haría que MemTrace marcara como «Deployed» algo que nadie desplegó.
- En MemTrace, edita el agente: repositorio `https://github.com/<org>/<repo>`, workflow `weather-assistant-deploy.yml`, y en cada
  entorno la rama (`develop` en DEV, `main` en PRO).
