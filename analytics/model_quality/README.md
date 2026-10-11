# analytics/model_quality

Worker que sincroniza a ClickHouse la puntuación de calidad de cada modelo, para ponerla junto al precio en
**Costs › Model pricing** (ver la ampliación de [ADR-025](../../docs/adrs/pricing/adr-025-model-pricing-catalog-sync.md)).

## Cómo funciona

`python -m model_quality.main` descarga el último leaderboard de texto de Arena (categoría `overall`) y hace upsert en
`memtrace.model_quality`: por modelo, su Elo, el intervalo de confianza, los votos y el puesto. La fuente es el dataset público
`lmarena-ai/leaderboard-dataset` de Hugging Face, con licencia **CC BY 4.0** (la UI y la documentación citan a Arena).

- No necesita cuenta ni clave.
- El fichero es dato de un tercero: se lee solo con `pyarrow`, con tamaño máximo y validación de cada fila.
- **Falla cerrado.** Si no hay red, el fichero no está, le faltan columnas o quedan menos de 50 filas, el job termina con error y la
  tabla queda como estaba. Las puntuaciones envejecen, no desaparecen (la UI enseña la fecha del leaderboard).
- Un modelo que Arena retira deja de actualizarse; la UI lo marca como «ya no está en el ranking».
- No sabe nada de precios ni de nombres de LiteLLM: el cruce entre ambos catálogos lo hace la API al leer.

## Programación

CronJob diario (`k8s/86-model-quality-sync.yaml`). Arena publica unas pocas veces por semana. Para lanzarlo ya: `make quality-sync`.

## Consultar las puntuaciones

`memtrace.model_quality` es `ReplacingMergeTree(UpdatedAt)`: consulta con `FINAL`, nunca la tabla a pelo.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` | Conexión a ClickHouse |
| `MODEL_QUALITY_DATASET` | Dataset de Hugging Face, por defecto `lmarena-ai/leaderboard-dataset` |

## Tests

```
python -m venv .venv && .venv/bin/pip install -e '.[test]' && .venv/bin/pytest
```
