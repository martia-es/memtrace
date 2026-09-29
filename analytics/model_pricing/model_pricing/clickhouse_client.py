"""Acceso a ClickHouse para el worker de sincronización de precios (ADR-025).

Igual que la pieza 4 (API de consulta), este worker es el único que conoce el esquema
de `model_pricing` para su propio caso de uso; nada de SQL disperso fuera de aquí.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime

import clickhouse_connect
from clickhouse_connect.driver.client import Client


@dataclass
class PricingRow:
    model_id: str
    provider: str
    input_price_per_token: float
    output_price_per_token: float
    source: str
    updated_at: datetime


class ClickHouseClient:
    def __init__(self, client: Client, database: str = "memtrace") -> None:
        self._client = client
        self._db = database

    @classmethod
    def from_env(cls) -> "ClickHouseClient":
        client = clickhouse_connect.get_client(
            host=os.environ["CLICKHOUSE_HOST"],
            port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
            username=os.environ.get("CLICKHOUSE_USER", "default"),
            password=os.environ["CLICKHOUSE_PASSWORD"],
            database=os.environ.get("CLICKHOUSE_DATABASE", "memtrace"),
        )
        return cls(client, database=os.environ.get("CLICKHOUSE_DATABASE", "memtrace"))

    def upsert_pricing(self, rows: list[PricingRow]) -> None:
        """Inserta una nueva versión de cada fila; ReplacingMergeTree(UpdatedAt) deduplica por ModelId en el merge."""
        if not rows:
            return
        data = [
            [r.model_id, r.provider, r.input_price_per_token, r.output_price_per_token, r.source, r.updated_at]
            for r in rows
        ]
        self._client.insert(
            f"{self._db}.model_pricing",
            data,
            column_names=["ModelId", "Provider", "InputPricePerToken", "OutputPricePerToken", "Source", "UpdatedAt"],
        )
