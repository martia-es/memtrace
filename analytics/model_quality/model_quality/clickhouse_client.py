"""Acceso a ClickHouse para el worker de calidad por modelo (ADR-025): el único sitio que conoce el esquema de `model_quality`."""

from __future__ import annotations

import os
from datetime import datetime

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from model_quality.arena import ArenaRow

COLUMNS = ["Source", "Arena", "ModelName", "Organization", "License", "Rating", "RatingLower", "RatingUpper", "VoteCount", "Rank", "PublishedAt", "UpdatedAt"]


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

    def upsert_quality(self, rows: list[ArenaRow], source: str, arena: str, updated_at: datetime) -> None:
        """Inserta una versión nueva de cada entrada; ReplacingMergeTree(UpdatedAt) deja la última por (Source, Arena, ModelName)."""
        if not rows:
            return
        data = [
            [source, arena, r.model_name, r.organization, r.license, r.rating, r.rating_lower, r.rating_upper, r.vote_count, r.rank, r.published_at, updated_at]
            for r in rows
        ]
        self._client.insert(f"{self._db}.model_quality", data, column_names=COLUMNS)
