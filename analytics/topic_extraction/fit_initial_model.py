"""Fit inicial del modelo de temáticas. Se ejecuta a mano, una vez (o cuando toque re-entrenar), NUNCA desde el CronJob.

Uso:
    CLICKHOUSE_HOST=... CLICKHOUSE_PASSWORD=... python -m topic_extraction.fit_initial_model --days 30 --sample-size 5000
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from topic_extraction.clickhouse_client import ClickHouseClient
from topic_extraction.model import TopicModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fit_initial_model")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=30, help="Ventana histórica de la que muestrear")
    parser.add_argument("--sample-size", type=int, default=5000, help="Nº de respuestas para el fit")
    parser.add_argument("--model-path", type=Path, default=Path("/model/bertopic"))
    args = parser.parse_args()

    ch = ClickHouseClient.from_env()
    rows = ch.fetch_historical_responses(args.days, args.sample_size)
    if len(rows) < 50:
        raise SystemExit(f"Solo {len(rows)} respuestas disponibles: insuficiente para un fit representativo (mínimo recomendado: 50).")

    logger.info("Entrenando con %d respuestas de los últimos %d días...", len(rows), args.days)
    model = TopicModel.fit([r.text for r in rows])
    model.save(args.model_path)
    logger.info("Modelo guardado en %s", args.model_path)


if __name__ == "__main__":
    main()
