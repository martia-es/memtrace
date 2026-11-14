"""Entrypoint del CronJob de Mem (Fase 2.0, Observar): construye o recalcula los episodios de las trazas recientes.

No llama a ningún LLM. Cada pasada:
  1. toma las trazas cerradas (sin spans nuevos hace MEM_SETTLE_MINUTES) que aún no tienen episodio de la versión actual;
  2. recalcula las que ya tenían episodio pero recibieron después feedback o una puntuación;
  3. escribe una fila por traza en `mem_episodes` (la última escritura gana).
"""

from __future__ import annotations

import logging
import os

from mem.clickhouse_client import ClickHouseClient
from mem.episode import TraceSignals, build_episode

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mem")

BATCH_SIZE = int(os.environ.get("MEM_BATCH_SIZE", "500"))
SETTLE_MINUTES = int(os.environ.get("MEM_SETTLE_MINUTES", "10"))
LOOKBACK_DAYS = int(os.environ.get("MEM_LOOKBACK_DAYS", "7"))
MAX_BATCHES = int(os.environ.get("MEM_MAX_BATCHES", "20"))  # tope por pasada: un atraso grande se come en varias


def run() -> int:
    ch = ClickHouseClient.from_env()
    written = 0
    for _ in range(MAX_BATCHES):
        keys = ch.fetch_pending_traces(BATCH_SIZE, SETTLE_MINUTES, LOOKBACK_DAYS)
        keys += [k for k in ch.fetch_stale_traces(BATCH_SIZE, LOOKBACK_DAYS) if k not in keys]
        if not keys:
            break
        traces = ch.fetch_traces(keys)
        signals = ch.fetch_signals([t.key[2] for t in traces])
        episodes = []
        for t in traces:
            service, experiment, trace_id = t.key
            ep = build_episode(trace_id, service, experiment, t.spans, signals.get(trace_id, TraceSignals()),
                               conversation_id=t.conversation_id, revision=t.revision, prompt_name=t.prompt_name,
                               prompt_version=t.prompt_version, model=t.model)
            if ep is not None:
                episodes.append(ep)
        ch.insert_episodes(episodes)
        written += len(episodes)
        logger.info("Episodios escritos en esta tanda: %d (trazas leídas: %d)", len(episodes), len(traces))
        if len(keys) < BATCH_SIZE:
            break
    logger.info("Pasada completa: %d episodios.", written)
    return written


if __name__ == "__main__":
    run()
