"""Entrypoint del CronJob: clasifica respuestas nuevas con el modelo ya entrenado (ADR-022).

El fit inicial NO ocurre aquí — se hace a mano una vez (ver README) y se guarda en MODEL_PATH.
Si MODEL_PATH no existe, este job no tiene nada que transformar y termina sin hacer nada.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from topic_extraction.clickhouse_client import ClickHouseClient
from topic_extraction.model import MODEL_VERSION, TopicModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("topic_extraction")

MODEL_PATH = Path(os.environ.get("TOPIC_MODEL_PATH", "/model/bertopic"))
BATCH_SIZE = int(os.environ.get("TOPIC_BATCH_SIZE", "500"))


def run() -> None:
    if not MODEL_PATH.exists():
        logger.warning("No hay modelo entrenado en %s — ejecuta el fit inicial antes de programar este job.", MODEL_PATH)
        return

    ch = ClickHouseClient.from_env()
    model = TopicModel.load(MODEL_PATH)

    rows = ch.fetch_untagged_responses(BATCH_SIZE)
    if not rows:
        logger.info("Sin respuestas nuevas que clasificar.")
        return

    assignments = model.transform([r.text for r in rows])
    to_insert = [
        (row.trace_id, row.span_id, topic, confidence, MODEL_VERSION)
        for row, (topic, confidence) in zip(rows, assignments)
    ]
    ch.insert_topics(to_insert)
    logger.info("Clasificadas %d respuestas.", len(to_insert))


if __name__ == "__main__":
    run()
