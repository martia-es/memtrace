"""Entrypoint del CronJob: descarga el catálogo de precios de LiteLLM y lo sincroniza a ClickHouse (ADR-025).

LiteLLM mantiene `model_prices_and_context_window.json` actualizado en su repo (PRs de la
comunidad + día-0 de modelos nuevos). Este worker solo lo descarga y lo vuelca tal cual;
no interpreta ni corrige precios.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx

from model_pricing.clickhouse_client import ClickHouseClient, PricingRow

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("model_pricing")

SOURCE_URL = os.environ.get(
    "MODEL_PRICING_SOURCE_URL",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
)
SOURCE_NAME = "litellm"


def _parse(catalog: dict) -> list[PricingRow]:
    now = datetime.now(timezone.utc)
    rows: list[PricingRow] = []
    for model_id, entry in catalog.items():
        if model_id == "sample_spec" or not isinstance(entry, dict):
            continue
        input_price = entry.get("input_cost_per_token")
        output_price = entry.get("output_cost_per_token")
        if input_price is None or output_price is None:
            continue
        rows.append(
            PricingRow(
                model_id=model_id,
                provider=entry.get("litellm_provider") or "unknown",
                input_price_per_token=float(input_price),
                output_price_per_token=float(output_price),
                source=SOURCE_NAME,
                updated_at=now,
            )
        )
    return rows


def run() -> None:
    response = httpx.get(SOURCE_URL, timeout=30)
    response.raise_for_status()
    rows = _parse(response.json())
    if not rows:
        logger.warning("El catálogo descargado no tiene filas válidas — no se sincroniza nada.")
        return

    ch = ClickHouseClient.from_env()
    ch.upsert_pricing(rows)
    logger.info("Sincronizados %d modelos desde %s.", len(rows), SOURCE_URL)


if __name__ == "__main__":
    run()
