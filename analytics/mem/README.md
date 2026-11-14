# analytics/mem

Worker de **Mem** (Fase 2.0, *Observar*): construye un **episodio por traza** y lo escribe en `mem_episodes`. No llama a ningún LLM ni a Internet. Diseño: [phase_2_design.md](../../docs/archive/phase_2_design.md); validación previa con datos sintéticos: [spikes/mem](../../spikes/mem/README.md).

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

## Datos y privacidad

- Tabla derivada: se puede borrar y reconstruir desde las trazas.
- Lleva `ExperimentId` (aislamiento entre organizaciones, ADR-088).
- Sigue la retención de las trazas (ADR-084): el job de retención borra sus filas junto a los spans.
- `Goal` y `Answer` salen de los mensajes de la traza, que ya pasaron por el enmascarado de datos personales del SDK.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` | Conexión a ClickHouse |
| `MEM_BATCH_SIZE` | Trazas por tanda, por defecto `500` |
| `MEM_SETTLE_MINUTES` | Minutos sin spans nuevos para dar una traza por cerrada, por defecto `10` |
| `MEM_LOOKBACK_DAYS` | Hasta cuántos días atrás mira, por defecto `7` |
| `MEM_MAX_BATCHES` | Tandas máximas por pasada, por defecto `20` |

## Desarrollo

```bash
uv run --with pytest --with clickhouse-connect python -m pytest   # lógica del episodio, sin ClickHouse
make images                                                       # construye la imagen y la carga en kind
```
