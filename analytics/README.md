# analytics/topic_extraction

Worker que asigna una temática a cada respuesta del agente, sin llamar a ningún LLM (ver [ADR-022](../docs/adrs/adr-022-topic-extraction-bertopic.md)).

## Cómo funciona

1. **Fit inicial (manual, una sola vez)**: entrena BERTopic sobre una muestra histórica y guarda el modelo en disco.
   ```bash
   uv pip install -e .
   CLICKHOUSE_HOST=localhost CLICKHOUSE_PASSWORD=*** \
     python -m topic_extraction.fit_initial_model --days 30 --sample-size 5000 --model-path ./model/bertopic
   ```
2. **CronJob (automático, periódico)**: `python -m topic_extraction.main` carga el modelo ya entrenado y solo hace `.transform()` sobre las respuestas nuevas — no reentrena. Así los nombres de tema no cambian de una corrida a otra.

## Cuándo volver a hacer el fit

Cuando el tráfico cambie lo suficiente para que muchas respuestas nuevas caigan en el tema `outlier` (revisar `span_topics` agrupando por `Topic`). Es una decisión operativa, no algo que el CronJob dispare solo.

## Variables de entorno (CronJob)

| Variable | Descripción |
|---|---|
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` | Conexión a ClickHouse |
| `TOPIC_MODEL_PATH` | Ruta del modelo serializado (PVC montado), por defecto `/model/bertopic` |
| `TOPIC_BATCH_SIZE` | Nº máx. de respuestas por corrida, por defecto `500` |
