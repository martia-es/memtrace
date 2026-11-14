# Spike: Mem (Fase 2)

**Pregunta**: ¿podemos descubrir, a partir de trazas, qué falla de forma recurrente en un agente, redactarlo como lección y comprobar que aplicarla reduce el fallo? Diseño que se pone a prueba: [docs/archive/phase_2_design.md](../../docs/archive/phase_2_design.md).

**Truco del spike**: los datos son sintéticos y los fallos están **sembrados** con frecuencia conocida (`data/ground_truth.json`), así que se puede medir si el pipeline los encuentra. El pipeline nunca lee ese fichero; solo lo usa `evaluate.py` para puntuar.

## Estructura

| Fichero | Qué hace |
|---|---|
| `gen_traces.py` | Genera ~5.000 trazas con la forma de `otel_traces`, feedback y puntuaciones de evaluador |
| `episodes.py` | Agrupa spans en episodios y decide el resultado con varias señales |
| `discover.py` | Características automáticas y reglas que explican fallos, con tests estadísticos |
| `distill.py` | Redacta una lección por grupo de fallos (plantilla o LLM) y la verifica con conversaciones no usadas |
| `evaluate.py` | Compara lo descubierto con los fallos sembrados (único que conoce la solución) |
| `apply.py` | Prueba de efecto: pone cada lección en el prompt de un agente de laboratorio y mide si corrige el fallo |
| `main.py` | Lanza los pasos en orden y explica cada uno |
| `data/`, `out/` | Salidas (no se versionan) |

## Fallos sembrados

| Id | Fallo | Qué comprueba |
|---|---|---|
| F1 | Pregunta sin ciudad → `get_forecast(city="")` falla | Caso fácil, span en error |
| F2 | Bucle de reintentos tras un 429 | Patrón de secuencia |
| F3 | Compara dos ciudades pero consulta solo una; sin error, solo 👎 / evaluador | Fallo silencioso |
| F4 | Llama a `get_forecast` antes que a `geocode` | Orden de pasos |
| F5 | Solo falla con idioma `es` **y** modelo `model_b` (unidades mal), sin error | Confusores |
| F6 | Fallos transitorios aleatorios | Ruido: no debe ser lección |
| F7 | F1 baja a la mitad del periodo porque el prompt v2 pide la ciudad | Caducidad de la lección |

## Uso

```bash
uv run python main.py --sin-llm      # trazas, episodios, descubrimiento y evaluación (sin LLM)
uv run python main.py                # además redacta y verifica lecciones (necesita GEMINI_API_KEY en .env)
uv run python apply.py --n 12        # prueba de efecto; reanuda lo ya ejecutado y guarda en out/apply_results.jsonl
```

`apply.py` usa Groq por defecto (`GROQ_API_KEY` en `.env`, modelo `openai/gpt-oss-120b`). Con `APPLY_PROVIDER=gemini` usa Gemini, y `APPLY_MODEL` cambia el modelo. Si se agota la cuota diaria, sale limpio y se reanuda al relanzarlo.

## Resultados

**Descubrimiento** (frente a los fallos sembrados):

| Fallo | Recall | Pureza |
|---|---|---|
| F1 | 1,00 | 1,00 |
| F2 | 0,95 | 1,00 |
| F3 | 0,69 | 0,97 |
| F4 | 1,00 | 1,00 |
| F5 | 1,00 | 0,55 |
| F6 (ruido) | 0,14 | 0,04 |

El ruido F6 no se convierte en hallazgo y F7 se detecta: F1 baja de 8,2 a 0,84 por 100 trazas con el prompt v2.

**Prueba de efecto** (12 conversaciones por condición, test de Fisher unilateral, agente de laboratorio con `openai/gpt-oss-120b`):

| Lección | Fallos sin lección | Con lección | p | Control sin → con |
|---|---|---|---|---|
| Orden de herramientas | 12/12 | 0/12 | < 0,001 | 0/12 → 0/12 |
| Unidades en español | 10/12 | 0/12 | < 0,001 | 0/12 → 1/12 |
| Ciudad vacía | 12/12 | 0/12 | < 0,001 | 0/12 → 0/12 |
| Comparar ciudades | 11/12 | 1/12 | < 0,001 | 0/12 → 0/12 |
| Error de cuota | 7/12 | 0/12 | 0,002 | 0/12 → 0/12 |

## Lo que aprendimos

- **La redacción importa tanto como el hallazgo.** La lección de orden de herramientas, escrita como «llama a las herramientas en este orden», no corregía nada (fallaba 2 de 2) porque chocaba con una regla del prompt. Con «llama siempre a geocode antes que a get_forecast… aunque otra regla lo permita» corrige 12 de 12.
- **Un checker automático también necesita auditoría.** Dos checkers daban falsos resultados: `f_compare` contaba «Girona» y «Girona, Spain» como ciudades distintas, y `f_control` no reconocía «Londres» ni «Berlín». Las respuestas vacías del API se excluyen de las tasas.
- **Cuidado con el confusor F5**: la regla encuentra todos los fallos, pero también pilla trazas buenas (pureza 0,55).

## Límites

- Datos sintéticos y un solo agente de laboratorio con defectos puestos a propósito en el prompt: mide que una lección corrige el fallo, no que el fallo ocurra así en producción.
- Las lecciones las redactó Gemini y se probaron con otro modelo (Groq), lo que apoya que no dependen del modelo, pero es un solo modelo.
- 12 conversaciones por condición: alcanzan para efectos grandes, no para daños pequeños en el control.
- Falta la valoración humana de las lecciones (`out/lessons_for_review.md`).
