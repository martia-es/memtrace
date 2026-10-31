"""Brazo 3 de verdad: un LLM LEE la traza de Who&When, localiza el primer paso que se tuerce y lo clasifica en la taxonomía.

A diferencia de `bench_ceiling.py` (agrupa razones humanas ya escritas), aquí el modelo parte solo del historial. Se compara con
la etiqueta de causa y el paso decisivo de la persona, en los 40 casos de `whowhen_review.csv` (etiquetados a ciegas).
Diagnostica con un modelo distinto del que etiquetó (Claude) para no medir su propio sesgo.

Uso: GROQ_API_KEY=... uv run python bench_diagnose.py [--model openai/gpt-oss-120b] [--effort low]   (reanuda; guarda en out/diagnose_whowhen_<modelo>[_<esfuerzo>].jsonl)
Límite gratuito de Groq: 8.000 tokens/min, de ahí la pausa y el recorte de la traza.
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd
from sklearn.metrics import cohen_kappa_score

from bench_data.taxonomy import ALIASES, CAUSES

MAX_CHARS = 12_000
PROMPT = """You analyze a failed run of an AI agent system. The final answer was wrong. Read the conversation, find the FIRST step where
the run goes wrong (0-based message index as shown), and classify the cause.

Causes (pick exactly one id):
{causes}

Tie-breaks: classify by the FIRST step that goes wrong, not the final answer. bad_retrieval needs an attempt to obtain information that
fails or is off-target; answering from memory or assuming without basis is fabrication; bad_termination only if there was no attempt to
obtain or verify. Use unclear only if impossible to decide.

{hint}Reply with JSON only: {{"first_wrong_step": <int>, "diagnosis": "<one sentence>", "cause": "<id>"}}

TASK: {question}

CONVERSATION:
{conversation}"""


def render(steps: list[dict]) -> str:
    out, used = [], 0
    for s in steps:
        line = f"[{s['i']}] {s['actor']}: {s['text'][:900]}"
        if used + len(line) > MAX_CHARS:
            out.append("[…traza recortada…]")
            break
        out.append(line)
        used += len(line)
    return "\n".join(out)


def call(model: str, prompt: str, effort: str | None) -> dict:
    params = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0}
    if effort:
        params["reasoning_effort"] = effort
    body = json.dumps(params).encode()
    for attempt in range(6):
        req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", body,
                                     {"content-type": "application/json", "user-agent": "memtrace-spike/0", "authorization": f"Bearer {os.environ['GROQ_API_KEY']}"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                msg = json.load(r)["choices"][0]["message"]["content"]
            return json.loads(re.search(r"\{.*\}", msg, re.S).group(0))
        except urllib.error.HTTPError as e:
            wait = float(e.headers.get("retry-after") or 30 * (attempt + 1))
            print(f"HTTP {e.code}, espero {wait:.0f}s", flush=True)
            time.sleep(wait + 2)
        except (ValueError, AttributeError):
            return {"error": "respuesta no parseable"}
    return {"error": "sin respuesta"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="openai/gpt-oss-120b")
    ap.add_argument("--pause", type=float, default=25)
    ap.add_argument("--split", choices=["test", "dev"], default="test", help="test = los 40 etiquetados a ciegas (no se ajusta nada con ellos); dev = 30 de los otros 144")
    ap.add_argument("--hint", action="store_true", help="dar el paso decisivo (en producción lo daría el paso 4 del diseño; con el real es una cota optimista)")
    ap.add_argument("--effort", default=None, help="reasoning_effort (gpt-oss: low|medium|high; otros modelos: no pasarlo)")
    a = ap.parse_args()
    tag = f"{a.model.split('/')[-1]}{'_' + a.effort if a.effort else ''}{'_hint' if a.hint else ''}{'_dev' if a.split == 'dev' else ''}"
    OUT = Path(f"out/diagnose_whowhen_{tag}.jsonl")
    df = pd.read_parquet("out/datasets/whowhen.parquet")
    test = pd.read_csv("out/datasets/whowhen_review.csv").idx.tolist()
    idx = test if a.split == "test" else sorted(pd.Series([i for i in range(len(df)) if i not in set(test)]).sample(30, random_state=7))
    done = {json.loads(l)["idx"] for l in OUT.read_text().splitlines()} if OUT.exists() else set()
    causes = "\n".join(f"- {k}: {v}" for k, v in CAUSES.items())
    with OUT.open("a") as f:
        for i in idx:
            if i in done:
                continue
            r = df.iloc[i]
            res = call(a.model, PROMPT.format(causes=causes, question=r.meta["question"], conversation=render(list(r.steps)),
                                                  hint=f"The first wrong step is known to be message {r.decisive_step}: classify the cause of THAT step.\n\n" if a.hint else ""), a.effort)
            f.write(json.dumps({"idx": i, "model": a.model, **res}) + "\n")
            f.flush()
            time.sleep(a.pause)

    d = pd.DataFrame([json.loads(l) for l in OUT.read_text().splitlines()])
    d = d[d.get("cause").notna()].merge(df.reset_index()[["index", "cause_behavior", "decisive_step"]], left_on="idx", right_on="index")
    d["cause"] = d.cause.map(lambda c: ALIASES.get(c, c))
    ok = d.cause == d.cause_behavior
    step = pd.to_numeric(d.first_wrong_step, errors="coerce")
    print(f"{len(d)} diagnósticos | causa: acierto {ok.mean():.2f}, kappa {cohen_kappa_score(d.cause_behavior, d.cause):.2f} | "
          f"paso exacto {(step == d.decisive_step).mean():.2f}, ±1 {((step - d.decisive_step).abs() <= 1).mean():.2f}")
    print(pd.crosstab(d.cause_behavior, d.cause).to_string())


if __name__ == "__main__":
    main()
