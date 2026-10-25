"""Exgentic agent-llm-traces-v2 -> episodios (capas 1 y 4 del banco de pruebas).

Descarga (abierto, sin token):  uv run python -m bench_data.exgentic download
Construye:                      uv run python -m bench_data.exgentic build [--per-class 300]

Capa 1 (infra): `out/datasets/exgentic_index.parquet`, una fila por run con los tipos de error de sus spans.
  Los spans con error NO traen mensaje (solo `error.type`), así que no sirven para probar las regex de
  `classifyError`; sirven para saber cuántos runs fallan por infraestructura y no por comportamiento.
Capa 4 (contraste éxito/fallo): muestra de τ²-bench, mitad éxito y mitad fallo, sin runs con errores de infraestructura.
"""
import argparse
import urllib.request

import pandas as pd
import pyarrow.parquet as pq

from .common import OUT, RAW, clip, parts_text

BASE = "https://huggingface.co/datasets/Exgentic/agent-llm-traces-v2/resolve/main/data/train/{:04d}.parquet"
SHARDS = range(9)
TAU2 = ("tau2_airline", "tau2_retail", "tau2_telecom")
# error.type del proveedor -> catálogo ADR-066. chat_error y Unknown no dicen nada: se quedan sin causa.
INFRA = {
    "RateLimitError": "quota_exceeded",
    "BadRequestError": "invalid_request",
    "BadGatewayError": "service_unavailable",
    "InternalServerError": "service_unavailable",
}
STEP_CHARS = 1500


def download() -> None:
    dest = RAW / "exgentic"
    dest.mkdir(parents=True, exist_ok=True)
    for i in SHARDS:
        f = dest / f"{i:04d}.parquet"
        if not f.exists():
            print("descargando", f.name)
            urllib.request.urlretrieve(BASE.format(i), f)


def span_step(i: int, s: dict) -> dict:
    a = s["attributes"] or {}
    err = a.get("error.type")
    last_in = parts_text(a.get("gen_ai.input.messages"), last_only=True)  # el historial se repite en cada span
    return {
        "i": i,
        "actor": "agent",
        "text": clip(f"IN: {clip(last_in, 600)}\nOUT: {parts_text(a.get('gen_ai.output.messages'))}", STEP_CHARS),
        "error_type": None if err in (None, "None") else err,
    }


def runs():
    for i in SHARDS:
        for b in pq.ParquetFile(RAW / "exgentic" / f"{i:04d}.parquet").iter_batches(batch_size=20):
            yield from b.to_pylist()


def build(per_class: int, seed: int = 7) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index, keep = [], {}
    for r in runs():
        errs = [(s["attributes"] or {}).get("error.type") for s in r["spans"]]
        errs = [e for e in errs if e not in (None, "None")]
        row = dict(
            trace_id=r["session_id"], benchmark=r["benchmark"], harness=r["harness"], model=",".join(r["models"] or []),
            success=bool(r["success"]), score=r["score"], status=r["status"], tokens=r["total_tokens"],
            n_spans=len(r["spans"]), n_err=len(errs), err_types=sorted(set(errs)),
        )
        index.append(row)
        if r["benchmark"] in TAU2 and not errs and r["total_tokens"] <= 150_000:
            keep[r["session_id"]] = sorted(r["spans"], key=lambda s: s["start_time"])
    idx = pd.DataFrame(index)
    idx.to_parquet(OUT / "exgentic_index.parquet")

    pool = idx[idx.trace_id.isin(keep)]
    pick = pd.concat(
        g.sample(min(len(g), per_class // 3), random_state=seed)  # per_class repartido entre los 3 benchmarks
        for _, g in pool.groupby(["benchmark", "success"])
    )
    eps = []
    for _, r in pick.iterrows():
        eps.append(dict(
            source="exgentic", trace_id=r.trace_id, split_group=f"{r.benchmark}:{r.model}",
            outcome="success" if r.success else "fail", cause_infra=None, cause_behavior=None, cause_text=None,
            decisive_step=None, label_origin="task_outcome",
            meta=dict(benchmark=r.benchmark, harness=r.harness, model=r.model, tokens=int(r.tokens), score=r.score),
            steps=[span_step(i, s) for i, s in enumerate(keep[r.trace_id])],
        ))
    pd.DataFrame(eps).to_parquet(OUT / "exgentic_contrast.parquet")
    print(f"índice: {len(idx)} runs | contraste: {len(eps)} episodios "
          f"({sum(e['outcome'] == 'success' for e in eps)} éxito / {sum(e['outcome'] == 'fail' for e in eps)} fallo)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "build"])
    ap.add_argument("--per-class", type=int, default=300)
    a = ap.parse_args()
    download() if a.cmd == "download" else build(a.per_class)
