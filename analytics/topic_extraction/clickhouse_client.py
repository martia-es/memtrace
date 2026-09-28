"""Acceso a ClickHouse para el worker de temáticas (ADR-022).

Igual que la pieza 4 (API de consulta), este worker es el único que conoce el esquema
de `otel_traces` / `span_topics` para su propio caso de uso; nada de SQL disperso fuera de aquí.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

import clickhouse_connect
from clickhouse_connect.driver.client import Client


@dataclass
class ResponseRow:
    trace_id: str
    span_id: str
    text: str


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

    def fetch_untagged_responses(self, limit: int) -> list[ResponseRow]:
        """Spans de respuesta de LLM que aún no tienen fila en `span_topics`."""
        query = f"""
            SELECT t.TraceId AS TraceId, t.SpanId AS SpanId,
                   t.SpanAttributes['gen_ai.output.messages'] AS Text
            FROM {self._db}.otel_traces AS t
            LEFT JOIN {self._db}.span_topics AS st
                ON t.TraceId = st.TraceId AND t.SpanId = st.SpanId
            WHERE t.SpanAttributes['gen_ai.operation.name'] = 'chat'
              AND t.SpanAttributes['gen_ai.output.messages'] != ''
              AND st.SpanId = ''
            LIMIT {{limit:UInt32}}
        """
        result = self._client.query(query, parameters={"limit": limit})
        return [ResponseRow(trace_id=r[0], span_id=r[1], text=r[2]) for r in result.result_rows]

    def fetch_historical_responses(self, days: int, sample_size: int) -> list[ResponseRow]:
        """Muestra para el fit inicial del modelo (ver README: ciclo fit/transform)."""
        query = f"""
            SELECT TraceId, SpanId, SpanAttributes['gen_ai.output.messages'] AS Text
            FROM {self._db}.otel_traces
            WHERE SpanAttributes['gen_ai.operation.name'] = 'chat'
              AND SpanAttributes['gen_ai.output.messages'] != ''
              AND Timestamp >= now() - INTERVAL {{days:UInt32}} DAY
            ORDER BY rand()
            LIMIT {{sample_size:UInt32}}
        """
        result = self._client.query(query, parameters={"days": days, "sample_size": sample_size})
        return [ResponseRow(trace_id=r[0], span_id=r[1], text=r[2]) for r in result.result_rows]

    def insert_topics(self, rows: list[tuple[str, str, str, float, str]]) -> None:
        """Cada fila: (trace_id, span_id, topic, confidence, model_version)."""
        if not rows:
            return
        now = datetime.now(timezone.utc)
        data = [[trace_id, span_id, topic, confidence, model_version, now] for trace_id, span_id, topic, confidence, model_version in rows]
        self._client.insert(
            f"{self._db}.span_topics",
            data,
            column_names=["TraceId", "SpanId", "Topic", "Confidence", "ModelVersion", "ExtractedAt"],
        )
