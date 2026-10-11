"""Entrypoint del CronJob: descarga el leaderboard de Arena y lo sincroniza a ClickHouse (ADR-025, ampliación).

Solo vuelca lo que Arena publica; no interpreta ni corrige puntuaciones. Si algo falla (red, fichero ausente, forma distinta,
muy pocas filas) el job termina con error y la tabla queda como estaba: las puntuaciones envejecen, no desaparecen.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone

import httpx

from model_quality.arena import ArenaError, fetch_latest
from model_quality.clickhouse_client import ClickHouseClient

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)  # sus líneas llevan la URL firmada de la descarga
logger = logging.getLogger("model_quality")

DATASET = os.environ.get("MODEL_QUALITY_DATASET", "lmarena-ai/leaderboard-dataset")
SOURCE = "arena"
BOARD = "text"
CATEGORY = "overall"


def run() -> None:
    with httpx.Client(timeout=60, headers={"User-Agent": "memtrace-model-quality"}) as http:
        rows = fetch_latest(http, DATASET, BOARD, CATEGORY)
    ch = ClickHouseClient.from_env()
    ch.upsert_quality(rows, SOURCE, BOARD, datetime.now(timezone.utc))
    published = max(r.published_at for r in rows).date()
    logger.info("Sincronizados %d modelos del tablero '%s' (leaderboard del %s) desde %s.", len(rows), BOARD, published, DATASET)


if __name__ == "__main__":
    try:
        run()
    except (ArenaError, httpx.HTTPError) as error:
        logger.error("No se sincronizó el leaderboard; las puntuaciones anteriores se conservan: %s", error)
        sys.exit(1)
