"""MAST / MAD (NeurIPS 2025, CC BY 4.0) -> episodios (capa de volumen del banco de pruebas).

Descarga (abierto, sin token, 200 MB):  python -m bench_data.mast download
Construye:                              python -m bench_data.mast build [--n 300] [--max-chars 60000]

Las trazas son logs de chat de sistemas multiagente (texto, no spans OTel) y las etiquetas (14 modos MAST) las puso un
LLM-juez, salvo 19 con revisión humana. Se muestrea a propósito: trazas cortas (diagnosticar con un LLM es caro), un tercio
sin ningún modo (contraste) y el resto sesgado hacia los modos raros, para que `context_loss` e `instruction_violation`
tengan casos suficientes (Who&When casi no los tiene).

`cause_behavior` queda vacío: un código MAST puede caer en varias causas nuestras (p. ej. 2.6) y no se decide a ciegas.
Los códigos y las causas candidatas van en `meta`.
"""
import argparse
import json
import urllib.request
from collections import Counter

import numpy as np
import pandas as pd

from .common import OUT, RAW
from .taxonomy import MAST

URL = "https://huggingface.co/datasets/mcemri/MAD/resolve/main/MAD_full_dataset.json"
CHUNK = 2000


def candidates(code: str) -> list[str]:
    return [c for c, codes in MAST.items() if code in codes]


def chunks(text: str) -> list[dict]:
    """Troceado ciego en párrafos de ~CHUNK caracteres: los logs de cada framework no comparten formato."""
    steps, cur = [], ""
    for para in text.split("\n\n"):
        if cur and len(cur) + len(para) > CHUNK:
            steps.append(cur)
            cur = ""
        cur += para + "\n\n"
    if cur.strip():
        steps.append(cur)
    return [{"i": i, "actor": None, "text": s.strip()[: CHUNK * 2], "error_type": None} for i, s in enumerate(steps)]


def download() -> None:
    dest = RAW / "mast"
    dest.mkdir(parents=True, exist_ok=True)
    if not (dest / "MAD_full_dataset.json").exists():
        urllib.request.urlretrieve(URL, dest / "MAD_full_dataset.json")


def build(n: int, max_chars: int, seed: int = 7) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = json.loads((RAW / "mast" / "MAD_full_dataset.json").read_text())
    pool = []
    for r in rows:
        a = r["mast_annotation"]
        if any(v is None for v in a.values()) or not isinstance(r["trace"]["trajectory"], str):
            continue
        text = r["trace"]["trajectory"]
        if len(text) <= max_chars:
            pool.append((r, [k for k, v in a.items() if v == 1], text))
    clean = [p for p in pool if not p[1]]
    bad = [p for p in pool if p[1]]
    freq = Counter(c for _, codes, _ in bad for c in codes)
    rng = np.random.default_rng(seed)
    w = np.array([sum(1 / freq[c] for c in codes) for _, codes, _ in bad])
    n_clean = min(len(clean), n // 3)
    pick = [clean[i] for i in rng.choice(len(clean), n_clean, replace=False)]
    pick += [bad[i] for i in rng.choice(len(bad), min(len(bad), n - n_clean), replace=False, p=w / w.sum())]

    eps = []
    for r, codes, text in pick:
        eps.append(dict(
            source="mast", trace_id=f"{r['mas_name']}-{r['benchmark_name']}-{r['trace_id']}",
            split_group=f"{r['mas_name']}:{r['benchmark_name']}", outcome="fail" if codes else "success",
            cause_infra=None, cause_behavior=None, cause_text=None, decisive_step=None, label_origin="llm_judge",
            meta=dict(mas=r["mas_name"], llm=r["llm_name"], benchmark=r["benchmark_name"], chars=len(text),
                      mast_codes=codes, candidates={c: candidates(c) for c in codes}),
            steps=chunks(text),
        ))
    pd.DataFrame(eps).to_parquet(OUT / "mast.parquet")
    print(f"pool ≤{max_chars} car.: {len(pool)} ({len(clean)} sin modos) | muestra: {len(eps)}")
    print("modos en la muestra:", sorted(Counter(c for e in eps for c in e["meta"]["mast_codes"]).items()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "build"])
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--max-chars", type=int, default=60_000)
    a = ap.parse_args()
    download() if a.cmd == "download" else build(a.n, a.max_chars)
