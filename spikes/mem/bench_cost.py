"""Coste de diagnosticar con un LLM cada episodio fallido del banco de pruebas (1 llamada por episodio, sin reintentos).

Tokens de entrada: Who&When y MAST = caracteres / 4 (aproximación); Exgentic = mayor `input_tokens` de sus spans (el último
span ya lleva todo el historial). Salida: 300 tokens por diagnóstico. Precios en USD por millón (entrada/salida), SIN confirmar:
vienen de comparativas web de octubre de 2026 que se contradicen entre sí.

Uso: uv run python bench_cost.py
"""
import pandas as pd
import pyarrow.parquet as pq

from bench_data.common import RAW

OUT_TOK = 300
PRICES = {"barato (0,10 / 0,50)": (0.10, 0.50), "medio (0,25 / 1,50)": (0.25, 1.50), "caro (1,00 / 5,00)": (1.00, 5.00)}

ww = pd.read_parquet("out/datasets/whowhen.parquet")
ww_tok = pd.Series([sum(len(str(m["content"])) for m in h) / 4
                    for sub in ("Algorithm-Generated", "Hand-Crafted")
                    for h in pd.read_parquet(RAW / "whowhen" / f"{sub}.parquet")["history"]])
mast = pd.read_parquet("out/datasets/mast.parquet")
mast = mast[mast.outcome == "fail"]
mast_tok = mast.meta.map(lambda m: m["chars"] / 4)

ex = pd.read_parquet("out/datasets/exgentic_contrast.parquet")
ids = set(ex[ex.outcome == "fail"].trace_id)
ex_tok = []
for i in range(9):
    for b in pq.ParquetFile(RAW / "exgentic" / f"{i:04d}.parquet").iter_batches(batch_size=20, columns=["session_id", "spans"]):
        for r in b.to_pylist():
            if r["session_id"] in ids:
                ex_tok.append(max(float((s["attributes"] or {}).get("gen_ai.usage.input_tokens") or 0) for s in r["spans"]))
ex_tok = pd.Series(ex_tok)

rows = []
for name, tok in [("Who&When (fallos)", ww_tok), ("MAST (fallos)", mast_tok), ("Exgentic τ² (fallos)", ex_tok)]:
    row = {"fuente": name, "n": len(tok), "tok/episodio (mediana)": int(tok.median()), "p90": int(tok.quantile(.9)), "total M tok": round(tok.sum() / 1e6, 2)}
    for p, (pi, po) in PRICES.items():
        row[f"USD {p.split()[0]}"] = round((tok.sum() * pi + len(tok) * OUT_TOK * po) / 1e6, 2)
    rows.append(row)
print(pd.DataFrame(rows).to_string(index=False))
print("\nLímite gratuito de Groq medido: 8.000 tokens/min; los episodios de mediana > 8.000 tokens no caben en una sola llamada.")
