"""Valida el descubrimiento de PRODUCCIÓN (`analytics/mem/mem/discovery.py`) con los datos sintéticos del spike.

Lee los episodios que ya calculó el spike (`out/episodes.pkl`), los pasa por el código de producción y puntúa los hallazgos
contra `data/ground_truth.json`, igual que `evaluate.py`. Así se comprueba que portar el algoritmo no lo ha empeorado.

Uso (desde el entorno del spike, con el paquete de producción en el path):
    PYTHONPATH=../../analytics/mem uv run python check_production.py [--sin-grupos]
"""
import argparse
import json
from pathlib import Path

import pandas as pd

from mem.discovery import Config, cluster_goals, discover, sentence_transformers_embedder

HERE = Path(__file__).parent
MODES = ["F1", "F2", "F3", "F4", "F5", "F6"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=HERE, help="carpeta del spike con data/ y out/")
    ap.add_argument("--sin-grupos", action="store_true", help="no agrupar objetivos (no carga el modelo de embeddings)")
    args = ap.parse_args()

    truth = json.loads((args.data_dir / "data" / "ground_truth.json").read_text())
    eps = pd.read_pickle(args.data_dir / "out" / "episodes.pkl").reset_index(drop=True)
    labels, k = None, 0
    if not args.sin_grupos:
        labels, k, sil = cluster_goals(eps["goal"], sentence_transformers_embedder())
        print(f"Grupos de objetivo: k={k}, silueta={sil:.2f}")

    result = discover(eps, Config(), labels, k)
    print(f"\n{len(result.findings)} hallazgos sobre {result.episodes} episodios ({result.failed} fallos, {result.unexplained} sin explicar)")
    mode_ids = {m: {t for t, v in truth.items() if m in v["modes"]} for m in MODES}
    print("\n== Frente a los fallos sembrados ==")
    for m, ids in mode_ids.items():
        best = max(((len(ids & set(f.members)) / len(ids)) * (len(ids & set(f.members)) / max(len(f.members), 1)), i, f) for i, f in enumerate(result.findings)) \
            if result.findings else None
        if best is None:
            print(f"  {m}: sin hallazgos")
            continue
        _, i, f = best
        inter = len(ids & set(f.members))
        print(f"  {m}: #{i} recall {inter / len(ids):.2f}  pureza {inter / max(len(f.members), 1):.2f}  -> {f.rule[:75]}")
    print("\n  Ruido F6 dentro de cada hallazgo:")
    for i, f in enumerate(result.findings):
        print(f"    #{i}: {len(mode_ids['F6'] & set(f.members))}/{f.support}  {f.rule[:60]}")
    print("\n  Ocurrencia por 100 trazas y versión de prompt (F7: F1 debe caer con el prompt v2):")
    for i, f in enumerate(result.findings):
        print(f"    #{i}: {f.occurrence_by_prompt}  {f.rule[:50]}")


if __name__ == "__main__":
    main()
