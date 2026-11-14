# analytics/mem

Dos workers de **Mem**, ninguno llama a un LLM ni a Internet:

| Worker | Fase | Qué hace | Cuándo corre | Imagen |
|---|---|---|---|---|
| `mem.main` | 2.0 *Observar* | Un **episodio por traza** en `mem_episodes` | Cada 10 min | `mem` (ligera) |
| `mem.discovery_main` | 2.1 *Descubrir* | **Reglas que explican los fallos recurrentes** de cada agente, en `mem_findings` | Diario, 04:20 | `mem-discovery` (≈2 GB: scikit-learn, torch en CPU y el modelo de embeddings) |

El resto de esta sección describe los episodios; el descubrimiento está más abajo. Diseño: [phase_2_design.md](../../docs/archive/phase_2_design.md); validación previa con datos sintéticos: [spikes/mem](../../spikes/mem/README.md).

## Qué guarda un episodio

| Campo | Qué es |
|---|---|
| `Goal`, `Answer` | Último mensaje de usuario y última respuesta del modelo (recortados a 500 caracteres) |
| `Steps` | Pasos en orden: `chat` o el nombre de la herramienta |
| `DecisiveSpanId`, `DecisiveStep`, `DecisiveError`, `DecisiveException` | El span fallido más profundo (los padres heredan el error y no cuentan) |
| `Outcome`, `Value`, `Reasons` | Resultado multi-señal: `ok`, `suspect` o `failed`, la suma de pesos y qué señales contaron |
| `Thumbs`, `EvalScore` | Feedback del usuario final y la puntuación más baja de un evaluador |

Es una **estimación**, no una etiqueta de verdad. Señales y pesos (en `mem/episode.py`):

| Señal | Peso |
|---|---|
| Span en error | +1,0 |
| Bucle (misma herramienta con los mismos argumentos, o el mismo error del modelo, 3 veces) | +0,8 |
| Evaluador a 0 | +0,7 |
| 👎 | +0,6 |
| 👍 / evaluador a 1 | −0,3 / −0,2 |

`failed` ≥ 0,6 y `suspect` ≥ 0,3. Si cambias pesos, umbrales o la definición de bucle, sube `EPISODE_VERSION`: el worker recalcula los episodios de la versión anterior.

## Cómo funciona

El CronJob (`k8s/90-mem-episodes.yaml`, cada 10 minutos) hace en cada pasada:

1. Toma las trazas con actividad de modelo o herramienta que llevan `MEM_SETTLE_MINUTES` sin spans nuevos y no tienen episodio de la versión actual.
2. Recalcula las que ya tenían episodio pero recibieron después un voto o una puntuación (`user_feedback`, `eval_scores`).
3. Escribe una fila por traza; la última escritura gana (`ReplacingMergeTree`). Es idempotente: una segunda pasada sin novedades no escribe nada.

Solo cuentan las puntuaciones booleanas o numéricas en [0, 1]: son las que se leen sin ambigüedad como «falla / pasa».

## Descubrimiento (Fase 2.1)

Por cada agente (organización/experimento) con al menos 200 episodios en 7 días, `mem.discovery_main`:

1. Calcula **rasgos automáticos**, sin nombres de herramientas ni de fallos escritos a mano: atributos de la traza con pocos valores (idioma, modelo, versión de prompt…), grupo de objetivo, cuántas veces se llama a cada paso, qué paso va antes que cuál, repeticiones, argumentos vacíos y cuántas entidades menciona la petición.
2. Separa los fallos por lo que muestran (paso que falla y error); los silenciosos van juntos.
3. Por cada causa busca reglas por *cobertura secuencial*: un árbol poco profundo propone la condición más significativa, se retiran los fallos que explica y se repite. Cada regla pasa un test exacto de Fisher con Bonferroni (α = 0,01), exige un soporte mínimo de 30 y un *lift* mínimo de 1,5.
4. Simplifica las reglas, une las que describen lo mismo y mide cuánto ocurre **por versión de prompt**: así se ve si un fallo ya se corrigió (`OccurrenceByPrompt`).
5. Escribe la pasada en `mem_discovery_runs` (con los fallos que ninguna regla explica) y los hallazgos en `mem_findings`. La lectura toma la última pasada de cada agente.

Los objetivos se agrupan por significado con un modelo de embeddings multilingüe que **va dentro de la imagen** (`paraphrase-multilingual-MiniLM-L12-v2`): el job corre sin salida a Internet.

### Cómo se validó

Con los datos sintéticos del spike ([spikes/mem](../../spikes/mem/README.md)), cuyos fallos están sembrados con frecuencia conocida: `PYTHONPATH=../../analytics/mem uv run python check_production.py` (desde `spikes/mem`).

| Fallo sembrado | Recall | Pureza |
|---|---|---|
| F1 argumento vacío | 1,00 | 1,00 |
| F2 bucle de reintentos | 0,95 | 1,00 |
| F3 compara dos ciudades y consulta una (silencioso) | 1,00 | 0,99 |
| F4 orden de pasos | 1,00 | 1,00 |
| F5 solo con idioma `es` y `model_b` | 1,00 | 0,55 |
| F6 ruido | 0,14 | 0,04 (no es un hallazgo) |

Y F7 se ve: F1 baja de 8,24 a 0,84 por 100 trazas con el prompt v2. El recall de F3 pasó de 0,69 a 1,00 al añadir el rasgo «número de entidades de la petición», que no depende de la agrupación.

**Límites conocidos.** La pureza de F5 (0,55) es el techo con estas señales: solo el 55 % de los episodios de `model_b` en español falla, y nada en los pasos ni en el contexto distingue cuáles. Una agrupación de objetivos más fina (k=20 o 26) no mejora F3 de forma consistente, así que se mantiene la que maximiza la silueta. Con menos de 200 episodios no hay muestra para un test estadístico y no se escribe ningún hallazgo.

## Datos y privacidad

- Tabla derivada: se puede borrar y reconstruir desde las trazas.
- Lleva `ExperimentId` (aislamiento entre organizaciones, ADR-088).
- Sigue la retención de las trazas (ADR-084): el job de retención borra los episodios junto a los spans y los hallazgos y pasadas por fecha de pasada y organización.
- `Attributes` solo guarda atributos de la traza con valores cortos y sin pinta de identificar a nadie: se descartan `gen_ai.*`, `enduser.*`, las claves con `id`, `email`, `name`, `token`…, y los valores largos o con `@`. Es una lista de exclusión: revísala si tus agentes usan claves nuevas.
- `Goal` y `Answer` salen de los mensajes de la traza, que ya pasaron por el enmascarado de datos personales del SDK.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` | Conexión a ClickHouse |
| `MEM_BATCH_SIZE` | Trazas por tanda, por defecto `500` |
| `MEM_SETTLE_MINUTES` | Minutos sin spans nuevos para dar una traza por cerrada, por defecto `10` |
| `MEM_LOOKBACK_DAYS` | Hasta cuántos días atrás mira, por defecto `7` |
| `MEM_MAX_BATCHES` | Tandas máximas por pasada, por defecto `20` |
| `MEM_DISCOVERY_WINDOW_DAYS` | Días de episodios que mira el descubrimiento, por defecto `7` |
| `MEM_DISCOVERY_MAX_EPISODES` | Episodios máximos por agente (acota la memoria), por defecto `50000` |
| `MEM_DISCOVERY_MIN_EPISODES` | Episodios mínimos por agente para descubrir, por defecto `200` |

## Desarrollo

```bash
uv run --extra test python -m pytest                              # episodio y descubrimiento, sin ClickHouse ni embeddings
make images                                                       # construye las dos imágenes y las carga en kind
```
