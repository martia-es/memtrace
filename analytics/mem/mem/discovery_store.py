"""Acceso a ClickHouse del descubrimiento (Fase 2.1): episodios de entrada y hallazgos de salida.

Aparte de `clickhouse_client.py` a propósito: este módulo trae pandas y scikit-learn, y el worker de episodios (que corre
cada pocos minutos) no los necesita ni en su imagen.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from mem.clickhouse_client import ClickHouseClient
from mem.discovery import DISCOVERY_VERSION, Discovery
from mem.episode import EPISODE_VERSION


class DiscoveryStore(ClickHouseClient):
    def fetch_tenants_with_episodes(self, window_days: int, min_episodes: int) -> list[tuple[str, str, int]]:
        """Agentes (organización/experimento) con episodios suficientes en la ventana para que un test estadístico signifique algo."""
        query = f"""
            SELECT ServiceName, ExperimentId, count() AS n
            FROM {self._db}.mem_episodes FINAL
            WHERE StartedAt >= now() - INTERVAL {{days:UInt32}} DAY AND EpisodeVersion = {{version:UInt16}}
            GROUP BY ServiceName, ExperimentId
            HAVING n >= {{min:UInt32}}
            ORDER BY n DESC
        """
        params = {"days": window_days, "version": EPISODE_VERSION, "min": min_episodes}
        return [(r[0], r[1], int(r[2])) for r in self._client.query(query, parameters=params).result_rows]

    def fetch_episode_frame(self, service: str, experiment: str, window_days: int, limit: int) -> pd.DataFrame:
        """Episodios más recientes de un agente, en la forma que espera `discovery.discover`."""
        query = f"""
            SELECT TraceId, Goal, Outcome, HasError, DecisiveStep, DecisiveError, Steps, Attributes, EmptyArgTools,
                   PromptVersion, Model
            FROM {self._db}.mem_episodes FINAL
            WHERE ServiceName = {{service:String}} AND ExperimentId = {{experiment:String}}
              AND StartedAt >= now() - INTERVAL {{days:UInt32}} DAY AND EpisodeVersion = {{version:UInt16}}
            ORDER BY StartedAt DESC
            LIMIT {{limit:UInt32}}
        """
        params = {"service": service, "experiment": experiment, "days": window_days, "version": EPISODE_VERSION, "limit": limit}
        rows = self._client.query(query, parameters=params).result_rows
        frame = pd.DataFrame({
            "trace_id": [r[0] for r in rows],
            "goal": [r[1] for r in rows],
            "outcome": [r[2] for r in rows],
            "has_error": [bool(r[3]) for r in rows],
            "decisive_step": [r[4] for r in rows],
            "decisive_error": [r[5] for r in rows],
            "steps": [">".join(r[6]) for r in rows],
            "tools": [">".join(x for x in r[6] if x != "chat") for r in rows],
            # el modelo y la versión de prompt también son contexto: se ofrecen como atributos más
            "attrs": [{**dict(r[7]), **({"gen_ai.request.model": r[10]} if r[10] else {}),
                       **({"prompt.version": str(r[9])} if r[9] else {})} for r in rows],
            "empty_arg_tools": [",".join(r[8]) for r in rows],
            "prompt_version": [str(r[9]) for r in rows],
        })
        return frame

    def insert_discovery(self, service: str, experiment: str, window_days: int, result: Discovery) -> None:
        now = datetime.now(timezone.utc)
        self._client.insert(
            f"{self._db}.mem_discovery_runs",
            [[service, experiment, now, window_days, result.episodes, result.failed, result.unexplained,
              result.unexplained_top, result.goal_clusters, DISCOVERY_VERSION]],
            column_names=["ServiceName", "ExperimentId", "RunAt", "WindowDays", "Episodes", "Failed", "Unexplained",
                          "UnexplainedTop", "GoalClusters", "DiscoveryVersion"],
        )
        if not result.findings:
            return
        self._client.insert(
            f"{self._db}.mem_findings",
            [[service, experiment, now, f.finding_id, f.cause, f.rule, f.support, f.failures, f.failure_rate, f.lift, f.p_value,
              f.decisive_step, f.decisive_error, f.tool_sequence, f.occurrence_by_prompt, f.example_trace_ids, DISCOVERY_VERSION]
             for f in result.findings],
            column_names=["ServiceName", "ExperimentId", "RunAt", "FindingId", "Cause", "Rule", "Support", "Failures", "FailureRate",
                          "Lift", "PValue", "DecisiveStep", "DecisiveError", "ToolSequence", "OccurrenceByPrompt",
                          "ExampleTraceIds", "DiscoveryVersion"],
        )
