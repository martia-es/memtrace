"""Who&When (ICML 2025) -> episodios (capa de verdad humana del banco de pruebas).

Descarga (abierto, sin token):  python -m bench_data.whowhen download
Construye:                      python -m bench_data.whowhen build

Solo trae fallos. Cada uno tiene agente culpable, paso decisivo y una razón en texto libre; NO trae categoría de causa,
así que `cause_behavior` queda vacío hasta que se fije la taxonomía (Q10) y se etiquete a partir de `cause_text`.
"""
import argparse
import urllib.request

import pandas as pd

from .common import OUT, RAW, clip

BASE = "https://huggingface.co/datasets/Kevin355/Who_and_When/resolve/main/{}.parquet"
SUBSETS = ("Algorithm-Generated", "Hand-Crafted")


def download() -> None:
    dest = RAW / "whowhen"
    dest.mkdir(parents=True, exist_ok=True)
    for n in SUBSETS:
        if not (dest / f"{n}.parquet").exists():
            urllib.request.urlretrieve(BASE.format(n), dest / f"{n}.parquet")


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    eps = []
    for n in SUBSETS:
        for _, r in pd.read_parquet(RAW / "whowhen" / f"{n}.parquet").iterrows():
            steps = [
                {"i": i, "actor": m.get("name") or m.get("role"), "text": clip(str(m["content"])), "error_type": None}
                for i, m in enumerate(r["history"])
            ]
            eps.append(dict(
                source="whowhen", trace_id=r["question_ID"], split_group=r["question_ID"], outcome="fail",
                cause_infra=None, cause_behavior=None, cause_text=r["mistake_reason"],
                decisive_step=int(r["mistake_step"]), label_origin="human",
                meta=dict(subset=n, mistake_agent=r["mistake_agent"], question=clip(r["question"], 400)),
                steps=steps,
            ))
    pd.DataFrame(eps).to_parquet(OUT / "whowhen.parquet")
    print(f"{len(eps)} episodios")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "build"])
    download() if ap.parse_args().cmd == "download" else build()
