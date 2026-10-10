# Asistente RAG de FAQs

Asistente virtual que responde las preguntas frecuentes de una empresa (por defecto, **Iberia**) con Pydantic AI, expuesto por una API (FastAPI) y una UI web. Busca en su base de conocimiento antes de responder y cita las FAQs que usó. Es el segundo agente de referencia de MemTrace, junto al [asistente del tiempo](../weather_assistant/README.md): este ejercita los spans `retriever` y las métricas de recuperación.

> Las FAQs de `app/knowledge/data/iberia_faqs.jsonl` son **datos de ejemplo, no oficiales**: sirven para probar el flujo, no para informar a viajeros reales.

## Estructura

```
app/
  main.py                 # FastAPI + lifespan (crea el índice, el agente y las sesiones)
  config.py               # Variables de entorno
  agents/                 # Construcción del agente y dependencias (AssistantDeps)
  guardrails/             # Guardarraíl de entrada (input.py): longitud, datos personales, inyección de prompt
  knowledge/              # Retriever (puerto + BM25) y datos (data/iberia_faqs.jsonl)
  capabilities/           # faq.py: la tool `search_faqs`; registry.py las lista
  api/                    # Rutas y schemas HTTP
  sessions.py             # Historial de conversación por sesión
static/index.html         # UI de chat (con las fuentes consultadas bajo cada respuesta)
evals/                    # Dataset, evaluadores y run_eval.py
tests/                    # Sin red ni LLM
```

## Ejecutar

Requiere `GOOGLE_API_KEY` en el `.env` de la raíz del repo (o en el entorno).

```bash
make rag                  # desde la raíz: http://localhost:8001
# o, a mano:
cd rag_assistant && uv sync --all-groups && uv run uvicorn app.main:app --reload --port 8001
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Body `{"message": "...", "session_id": "opcional"}`. Devuelve `{"session_id", "reply", "sources", "blocked", "trace_id"}`; `sources` son las FAQs consultadas (`id`, `title`) |
| `POST` | `/api/chat/feedback` | 👍/👎 sobre la traza de una respuesta (igual que en el asistente del tiempo, ADR-062) |
| `DELETE` | `/api/sessions/{session_id}` | Borra el historial de una sesión |
| `GET` | `/api/capabilities` | Capabilities activas |
| `GET` | `/api/prompt` | Qué prompt usa: el del registro de MemTrace (`faq-system`) o el texto por defecto |
| `GET` | `/health` | Abierto: `200` cuando el agente está construido, `503` mientras arranca |

Variables opcionales: `RAG_ASSISTANT_MODEL`, `RAG_ASSISTANT_COMPANY` (nombre que usa en el prompt) y `RAG_ASSISTANT_KNOWLEDGE` (ruta a otro `.jsonl` de FAQs).

## Cómo recupera

`Retriever` es un puerto (`search(query, top_k)`); la implementación por defecto es BM25 léxico, sin red ni claves, así que las pruebas y evaluaciones son deterministas. `search_faqs` solo devuelve fragmentos con al menos dos términos de la pregunta en común (o el único que tenga): si no hay nada relevante, el agente dice que no lo sabe y remite a atención al cliente. Cada FAQ lleva un campo `keywords` con las palabras con que la gente pregunta (incluido inglés): BM25 no entiende sinónimos. Para pasar a embeddings, escribe otra clase con `search()` y cámbiala en `main.py`.

Para atender a otra empresa: un `.jsonl` nuevo (`id`, `title`, `category`, `text`, `keywords`) y `RAG_ASSISTANT_COMPANY`.

## Trazas, prompt y evaluación

Con `RAG_ASSISTANT_MEMTRACE_HEADERS` (`authorization=Bearer mtk_...`) envía trazas a MemTrace; cada búsqueda es un span `retriever` con los fragmentos devueltos (el texto solo con `MEMTRACE_CAPTURE_CONTENT=true`). Con `MEMTRACE_API_URL` (con el id del experimento) y `MEMTRACE_API_KEY` lee su prompt `faq-system` del [registro](../docs-site/platform/prompts.md). Para el playground añade `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true` (solo en no producción).

```bash
uv run pytest                                          # sin LLM ni red
uv run python evals/run_eval.py --local                # 21 casos con el LLM real; evaluadores de código + recuperación
uv run python evals/run_eval.py --judge                # + LLM-as-judge contra la respuesta ideal
uv run python evals/run_eval.py --mock --local         # sin LLM: todo pasa (prueba del gate)
```

`evals/dataset.jsonl` mezcla preguntas con FAQ esperada (`metadata.relevant_docs`, que miden `recall_at_3`, `mrr` y `hit_rate`) y preguntas fuera de alcance, donde no debe llegar contexto y el agente tiene que reconocerlo (`response_checks`). Para subir trazas, dataset y run a MemTrace, define `RAG_ASSISTANT_SERVICE_NAME`, `MEMTRACE_API_URL` y `MEMTRACE_API_KEY` como se explica en la cabecera de `run_eval.py`.

## Pendiente

Embeddings como segundo retriever (híbrido), y los workflows de CI/despliegue (ADR-064) que ya tiene el asistente del tiempo.
