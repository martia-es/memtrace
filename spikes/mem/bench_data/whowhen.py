"""Who&When (ICML 2025) -> episodios (capa de verdad humana del banco de pruebas).

Descarga (abierto, sin token):  python -m bench_data.whowhen download
Construye:                      python -m bench_data.whowhen build

Solo trae fallos. Cada uno tiene agente culpable, paso decisivo y una razón en texto libre; NO trae categoría de causa.
`cause_behavior` sale de `labels/whowhen_claude.json` (taxonomía en `taxonomy.py`): un LLM leyó solo la razón humana, no es
verdad humana salvo los 40 de `whowhen_review.csv`, que una persona etiquetó a ciegas (kappa 0,73) y prevalecen sobre el LLM.
"""
import argparse
import json
import urllib.request

import pandas as pd

from .common import HERE, OUT, RAW, clip

LABELS = HERE / "bench_data" / "labels" / "whowhen_claude.json"  # primer anotador: Claude, sobre `cause_text`

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
    labels = {int(k): v for k, v in json.loads(LABELS.read_text()).items()} if LABELS.exists() else {}
    eps = []
    for n in SUBSETS:
        for _, r in pd.read_parquet(RAW / "whowhen" / f"{n}.parquet").iterrows():
            steps = [
                {"i": i, "actor": m.get("name") or m.get("role"), "text": clip(str(m["content"])), "error_type": None}
                for i, m in enumerate(r["history"])
            ]
            eps.append(dict(
                source="whowhen", trace_id=r["question_ID"], split_group=r["question_ID"], outcome="fail",
                cause_infra=None, cause_behavior=labels.get(len(eps)), cause_text=r["mistake_reason"],
                decisive_step=int(r["mistake_step"]), label_origin="human_step+llm_cause",
                meta=dict(subset=n, mistake_agent=r["mistake_agent"], question=clip(r["question"], 400)),
                steps=steps,
            ))
    df = pd.DataFrame(eps)
    df.to_parquet(OUT / "whowhen.parquet")
    # hoja para que una persona etiquete a ciegas (sin ver la etiqueta del LLM) una muestra y se pueda medir el acuerdo
    sample = df.sample(40, random_state=7)
    sheet = pd.DataFrame({"idx": sample.index, "agent": sample.meta.map(lambda m: m["mistake_agent"]),
                          "reason": sample.cause_text, "tu_etiqueta": ""})
    if not (OUT / "whowhen_review.csv").exists():  # no pisar las etiquetas de la persona
        sheet.to_csv(OUT / "whowhen_review.csv", index=False)
        sample[["cause_behavior"]].rename(columns={"cause_behavior": "etiqueta_llm"}).to_csv(OUT / "whowhen_review_key.csv")
    print(f"{len(eps)} episodios")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "build"])
    download() if ap.parse_args().cmd == "download" else build()
