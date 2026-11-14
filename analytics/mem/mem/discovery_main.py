"""Entrypoint del CronJob de descubrimiento (Fase 2.1): reglas que explican los fallos recurrentes de cada agente.

No llama a ningún LLM ni a Internet: los embeddings que agrupan los objetivos se calculan en local con un modelo que ya va
dentro de la imagen. Cada pasada, por cada agente (organización/experimento) con episodios suficientes en la ventana:
  1. lee sus episodios más recientes de `mem_episodes`;
  2. agrupa los objetivos por significado y minera reglas con tests estadísticos (`mem.discovery`);
  3. escribe una fila en `mem_discovery_runs` y los hallazgos en `mem_findings`.
Cada pasada es independiente de las anteriores: la lectura toma la más reciente.
"""

from __future__ import annotations

import logging
import os

from mem.discovery import Config, cluster_goals, discover, sentence_transformers_embedder
from mem.discovery_store import DiscoveryStore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mem.discovery")

WINDOW_DAYS = int(os.environ.get("MEM_DISCOVERY_WINDOW_DAYS", "7"))
MAX_EPISODES = int(os.environ.get("MEM_DISCOVERY_MAX_EPISODES", "50000"))  # tope por agente: acota la memoria del job
MIN_EPISODES = int(os.environ.get("MEM_DISCOVERY_MIN_EPISODES", str(Config().min_episodes)))


def run() -> int:
    store = DiscoveryStore.from_env()
    tenants = store.fetch_tenants_with_episodes(WINDOW_DAYS, MIN_EPISODES)
    if not tenants:
        logger.info("Ningún agente tiene %d episodios en %d días: nada que descubrir.", MIN_EPISODES, WINDOW_DAYS)
        return 0
    embed = sentence_transformers_embedder()  # una sola carga del modelo para todos los agentes
    written, failed = 0, 0
    for service, experiment, n in tenants:
        try:
            frame = store.fetch_episode_frame(service, experiment, WINDOW_DAYS, MAX_EPISODES)
            labels, k, _ = cluster_goals(frame["goal"], embed)
            result = discover(frame, Config(min_episodes=MIN_EPISODES), labels, k)
            store.insert_discovery(service, experiment, WINDOW_DAYS, result)
            written += len(result.findings)
            logger.info("%s: %d episodios, %d fallos, %d hallazgos, %d sin explicar", service, result.episodes, result.failed,
                        len(result.findings), result.unexplained)
        except Exception:  # un agente con datos raros no debe impedir el descubrimiento de los demás
            failed += 1
            logger.exception("Descubrimiento fallido para %s (%d episodios); se sigue con el siguiente.", service, n)
    if failed == len(tenants):  # si falla todo, el job tiene que verse en rojo
        raise SystemExit(1)
    return written


if __name__ == "__main__":
    run()
