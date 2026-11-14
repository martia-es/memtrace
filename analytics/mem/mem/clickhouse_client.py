"""Acceso a ClickHouse del worker de Mem.

Igual que los demás workers, es el único sitio que conoce el esquema de `otel_traces`, `user_feedback`, `eval_items`, `eval_scores` y
`mem_episodes` para este caso de uso; la lógica del episodio (`episode.py`) no sabe nada de SQL.

Las lecturas de `otel_traces` usan `final = 1` (ADR-099: la tabla es ReplacingMergeTree y puede tener duplicados sin fusionar).
"""

from __future__ import annotations

import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from mem.episode import EPISODE_VERSION, Episode, SpanRow, TraceSignals

DEDUPED = {"final": 1}
TraceKey = tuple[str, str, str]  # (ServiceName, ExperimentId, TraceId)
# Una puntuación de evaluador cuelga de un item de run (ADR-044); el item enlaza con la traza por TraceId.
EVAL_JOIN = ("sc.ServiceName = i.ServiceName AND sc.ExperimentId = i.ExperimentId "
             "AND sc.DatasetRunId = i.DatasetRunId AND sc.ItemIndex = i.ItemIndex")

EPISODE_COLUMNS = [
    "ServiceName", "ExperimentId", "TraceId", "ConversationId", "StartedAt", "Revision", "PromptName", "PromptVersion", "Model",
    "Goal", "Answer", "Steps", "NChat", "NTools", "DecisiveSpanId", "DecisiveStep", "DecisiveError", "DecisiveException",
    "HasError", "Loop", "Thumbs", "EvalScore", "Value", "Outcome", "Reasons", "EpisodeVersion", "BuiltAt",
]


@dataclass
class TraceData:
    key: TraceKey
    spans: list[SpanRow]
    conversation_id: str
    revision: str
    prompt_name: str
    prompt_version: int
    model: str


def parse_score(data_type: str, value_num: float | None) -> float | None:
    """Solo cuentan las puntuaciones con una lectura inequívoca de «falla / pasa»: booleanas (1/0) y numéricas en [0, 1]."""
    if value_num is None or data_type not in ("boolean", "numeric"):
        return None
    return float(value_num) if 0.0 <= value_num <= 1.0 else None


class ClickHouseClient:
    def __init__(self, client: Client, database: str = "memtrace") -> None:
        self._client = client
        self._db = database

    @classmethod
    def from_env(cls) -> "ClickHouseClient":
        database = os.environ.get("CLICKHOUSE_DATABASE", "memtrace")
        client = clickhouse_connect.get_client(
            host=os.environ["CLICKHOUSE_HOST"],
            port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
            username=os.environ.get("CLICKHOUSE_USER", "default"),
            password=os.environ["CLICKHOUSE_PASSWORD"],
            database=database,
        )
        return cls(client, database=database)

    # ---------- qué trazas hay que (re)calcular ----------

    def fetch_pending_traces(self, limit: int, settle_minutes: int, lookback_days: int) -> list[TraceKey]:
        """Trazas con actividad de modelo o herramienta, ya cerradas, sin episodio de la versión actual."""
        query = f"""
            SELECT ServiceName, ExperimentId, TraceId
            FROM {self._db}.otel_traces
            WHERE Timestamp >= now() - INTERVAL {{lookback:UInt32}} DAY
              AND SpanAttributes['gen_ai.operation.name'] IN ('chat', 'execute_tool')
            GROUP BY ServiceName, ExperimentId, TraceId
            HAVING max(Timestamp) <= now() - INTERVAL {{settle:UInt32}} MINUTE
               AND (ServiceName, ExperimentId, TraceId) NOT IN (
                   SELECT ServiceName, ExperimentId, TraceId FROM {self._db}.mem_episodes FINAL
                   WHERE StartedAt >= now() - INTERVAL {{lookback:UInt32}} DAY AND EpisodeVersion = {{version:UInt16}})
            ORDER BY max(Timestamp)
            LIMIT {{limit:UInt32}}
        """
        params = {"lookback": lookback_days, "settle": settle_minutes, "version": EPISODE_VERSION, "limit": limit}
        rows = self._client.query(query, parameters=params, settings=DEDUPED).result_rows
        return [(r[0], r[1], r[2]) for r in rows]

    def fetch_stale_traces(self, limit: int, lookback_days: int) -> list[TraceKey]:
        """Episodios ya calculados a los que después llegó feedback o una puntuación: el resultado puede haber cambiado."""
        query = f"""
            SELECT e.ServiceName, e.ExperimentId, e.TraceId
            FROM {self._db}.mem_episodes AS e FINAL
            INNER JOIN (
                SELECT TraceId, max(CreatedAt) AS Last FROM {self._db}.user_feedback GROUP BY TraceId
                UNION ALL
                SELECT assumeNotNull(i.TraceId) AS TraceId, max(sc.CreatedAt) AS Last
                FROM {self._db}.eval_scores AS sc FINAL
                INNER JOIN {self._db}.eval_items AS i FINAL ON {EVAL_JOIN}
                WHERE i.TraceId IS NOT NULL GROUP BY i.TraceId
            ) AS s ON e.TraceId = s.TraceId
            WHERE e.StartedAt >= now() - INTERVAL {{lookback:UInt32}} DAY AND e.EpisodeVersion = {{version:UInt16}}
            GROUP BY e.ServiceName, e.ExperimentId, e.TraceId, e.BuiltAt
            HAVING max(s.Last) > e.BuiltAt
            LIMIT {{limit:UInt32}}
        """
        params = {"lookback": lookback_days, "version": EPISODE_VERSION, "limit": limit}
        rows = self._client.query(query, parameters=params).result_rows
        return [(r[0], r[1], r[2]) for r in rows]

    # ---------- datos de las trazas ----------

    def fetch_traces(self, keys: list[TraceKey]) -> list[TraceData]:
        """Spans de las trazas pedidas, agrupados. Se filtra por TraceId y se comprueba el tenant después."""
        if not keys:
            return []
        wanted = {k[2]: k for k in keys}
        query = f"""
            SELECT ServiceName, ExperimentId, TraceId, SpanId, ParentSpanId, Timestamp, SpanName,
                   SpanAttributes['gen_ai.operation.name'], SpanAttributes['gen_ai.tool.name'],
                   SpanAttributes['gen_ai.tool.call.arguments'], SpanAttributes['gen_ai.tool.call.result'],
                   StatusCode, StatusMessage,
                   arrayFirst(x -> x != '', arrayMap((n, a) -> if(n = 'exception', a['exception.type'], ''), `Events.Name`, `Events.Attributes`)),
                   SpanAttributes['gen_ai.input.messages'], SpanAttributes['gen_ai.output.messages'],
                   ConversationId, Revision, PromptName, PromptVersion, SpanAttributes['gen_ai.request.model']
            FROM {self._db}.otel_traces
            WHERE TraceId IN {{ids:Array(String)}}
            ORDER BY TraceId, Timestamp
        """
        rows = self._client.query(query, parameters={"ids": list(wanted)}, settings=DEDUPED).result_rows
        grouped: dict[TraceKey, list[tuple]] = defaultdict(list)
        for r in rows:
            key = (r[0], r[1], r[2])
            if wanted.get(r[2]) == key:  # el tenant del span tiene que ser el de la clave pedida
                grouped[key].append(r)

        traces = []
        for key, group in grouped.items():
            spans = [SpanRow(span_id=r[3], parent_span_id=r[4], timestamp=r[5], name=r[6], operation=r[7], tool_name=r[8],
                             tool_args=r[9], tool_result=r[10], status_code=r[11], status_message=r[12], exception_type=r[13],
                             input_messages=r[14], output_messages=r[15]) for r in group]
            first = lambda i: next((r[i] for r in group if r[i]), "")  # noqa: E731 - primer valor no vacío de la traza
            traces.append(TraceData(key=key, spans=spans, conversation_id=first(16), revision=first(17), prompt_name=first(18),
                                    prompt_version=int(first(19) or 0), model=first(20)))
        return traces

    def fetch_signals(self, trace_ids: list[str]) -> dict[str, TraceSignals]:
        """Feedback del usuario final (👍/👎, sin los votos retirados) y puntuaciones de evaluadores por traza."""
        if not trace_ids:
            return {}
        params = {"ids": trace_ids}
        feedback = self._client.query(
            f"""SELECT TraceId, countIf(Rating > 0), countIf(Rating < 0)
                FROM (SELECT * FROM {self._db}.user_feedback FINAL WHERE TraceId IN {{ids:Array(String)}} AND IsDeleted = 0)
                GROUP BY TraceId""",
            parameters=params,
        ).result_rows
        scores = self._client.query(
            f"""SELECT assumeNotNull(i.TraceId), sc.DataType, sc.ValueNum
                FROM {self._db}.eval_scores AS sc FINAL
                INNER JOIN {self._db}.eval_items AS i FINAL ON {EVAL_JOIN}
                WHERE i.TraceId IN {{ids:Array(String)}}""",
            parameters=params,
        ).result_rows

        up_down = {r[0]: (int(r[1]), int(r[2])) for r in feedback}
        by_trace: dict[str, list[float]] = defaultdict(list)
        for trace_id, data_type, value_num in scores:
            parsed = parse_score(data_type, value_num)
            if parsed is not None:
                by_trace[trace_id].append(parsed)
        return {
            t: TraceSignals(thumbs_up=up_down.get(t, (0, 0))[0], thumbs_down=up_down.get(t, (0, 0))[1], eval_scores=tuple(by_trace.get(t, ())))
            for t in set(up_down) | set(by_trace)
        }

    # ---------- salida ----------

    def insert_episodes(self, episodes: list[Episode]) -> None:
        if not episodes:
            return
        now = datetime.now(timezone.utc)
        data = [[
            e.service_name, e.experiment_id, e.trace_id, e.conversation_id, e.started_at, e.revision, e.prompt_name,
            e.prompt_version, e.model, e.goal, e.answer, e.steps, e.n_chat, e.n_tools, e.decisive_span_id, e.decisive_step,
            e.decisive_error, e.decisive_exception, int(e.has_error), int(e.loop), e.thumbs, e.eval_score, e.value,
            e.outcome, e.reasons, EPISODE_VERSION, now,
        ] for e in episodes]
        self._client.insert(f"{self._db}.mem_episodes", data, column_names=EPISODE_COLUMNS)
