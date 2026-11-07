"""Mide si el juez acierta: una persona etiqueta una muestra a ciegas y se compara con el veredicto de los modelos.

  python validate.py                      -> out/validate.html (40 casos, sin ver el veredicto; al final «Descargar etiquetas»)
  python validate.py --score labels.json  -> acierto del juez frente a tus etiquetas (la descarga del navegador)

La muestra mezcla casos dudosos (los dos modelos no coinciden), «mal» y «bien», y reparte entre tipos de petición.
Se fija con una semilla, así que se puede repetir y comparar.
"""
import argparse
import html
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
LABELS = {"ok": "Bien", "partial": "A medias", "bad": "Mal"}


def sample(eps: list[dict], n: int = 40, seed: int = 3) -> list[dict]:
    rng = random.Random(seed)
    pools = {v: [e for e in eps if e["verdict"] == v] for v in ("unsure", "bad", "ok", "partial")}
    for p in pools.values():
        rng.shuffle(p)
    want = {"unsure": n * 3 // 8, "bad": n // 4, "ok": n - n * 3 // 8 - n // 4}
    out = []
    for v, k in want.items():  # dentro de cada grupo, se reparte entre tipos de petición
        by_intent = defaultdict(list)
        for e in pools[v]:
            by_intent[e["intent"]].append(e)
        picked = []
        while len(picked) < k and any(by_intent.values()):
            for i in sorted(by_intent):
                if by_intent[i] and len(picked) < k:
                    picked.append(by_intent[i].pop())
        out += picked
    rng.shuffle(out)
    return out


def case(e: dict, i: int) -> str:
    steps = "".join(f"<div class='st'>Consultó <b>{html.escape(s['tool'])}</b> <code>{html.escape(s['args'][:160])}</code> → {html.escape(s['result'][:160])}</div>"
                    for s in e["steps"] if s["kind"] == "tool") or "<div class='st'>No consultó nada</div>"
    prev = "".join(f"<div class='st'>Antes: {html.escape(t)}</div>" for t in e["history"][-2:])
    return (f"<section data-id='{e['id']}'><h3>Caso {i}</h3>{prev}<div class='q'><b>Cliente</b> · {html.escape(e['text'])}</div>{steps}"
            f"<div class='a'><b>Asistente</b> · {html.escape(e['reply'])}</div>"
            "<div class='b'>¿Dio al cliente lo que pidió? " + "".join(f"<label><input type='radio' name='c{i}' value='{k}'> {v}</label>" for k, v in LABELS.items())
            + f"<label><input type='radio' name='c{i}' value='skip'> No sé</label></div></section>")


PAGE = """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comprobar al juez</title>
<style>:root{--bg:#f2faf9;--p:#fff;--ink:#0a2321;--m:#4d6a67;--l:#d6e9e7;--a:#00857f}
@media(prefers-color-scheme:dark){:root{--bg:#081716;--p:#0e2221;--ink:#e6f4f2;--m:#8fb0ac;--l:#1d3c3a;--a:#2bc4bd}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:20px}section{background:var(--p);border:1px solid var(--l);border-radius:8px;padding:14px 18px;margin:12px 0}h3{margin:0 0 8px;font-size:13px;color:var(--m)}
.q,.a,.st{margin:4px 0}.st{color:var(--m);font-size:13px}code{font-size:12px}.b{margin-top:10px;display:flex;gap:16px;flex-wrap:wrap}
button{font:inherit;font-weight:700;background:var(--a);color:#fff;border:0;border-radius:6px;padding:10px 18px;cursor:pointer}</style></head><body><main>
<h1>¿Acierta el juez? Etiqueta estos 40 casos</h1><p style="color:var(--m)">No ves lo que dijo el juez. Marca si el asistente dio al cliente lo que pidió
(unidad, lugar y fecha correctos, y datos que salen de la consulta, no inventados). Unos 10 minutos.</p>
__CASES__
<p><button onclick="dl()">Descargar etiquetas</button> <span id="n" style="color:var(--m)"></span></p></main>
<script>function dl(){const o={};document.querySelectorAll('section').forEach((s,i)=>{const r=s.querySelector('input:checked');if(r)o[s.dataset.id]=r.value});
document.getElementById('n').textContent=Object.keys(o).length+' de 40 etiquetados';
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(o,null,1)],{type:'application/json'}));a.download='labels.json';a.click()}</script></body></html>"""


def score(eps: list[dict], labels: dict[str, str]) -> None:
    from sklearn.metrics import cohen_kappa_score
    by = {e["id"]: e for e in eps}
    rows = [(by[i], v) for i, v in labels.items() if i in by and v in LABELS]
    print(f"{len(rows)} casos etiquetados por ti")
    for name, pick in (("veredicto final (los dos coinciden)", lambda e: e["verdict"]), ("modelo 1", lambda e: e["judges"][0]), ("modelo 2", lambda e: e["judges"][1])):
        use = [(pick(e), v) for e, v in rows if pick(e) in LABELS]
        if not use:
            continue
        acc = sum(a == b for a, b in use) / len(use)
        binary = sum((a == "bad") == (b == "bad") for a, b in use) / len(use)
        k = cohen_kappa_score([a for a, _ in use], [b for _, b in use]) if len({a for a, _ in use} | {b for _, b in use}) > 1 else float("nan")
        print(f"- {name}: {len(use)} con veredicto · acierto {acc:.0%} · acierto «mal / no mal» {binary:.0%} · kappa {k:.2f}")
    decided = [(e["verdict"], v) for e, v in rows if e["verdict"] in LABELS]
    print("  qué dices tú cuando el juez dice «mal»:", dict(Counter(v for a, v in decided if a == "bad")))
    print("  y cuando dice «bien»:", dict(Counter(v for a, v in decided if a == "ok")))
    print("  en los casos dudosos tú dices:", dict(Counter(v for e, v in rows if e["verdict"] == "unsure")))
    print("Mínimo que propusimos para fiarse: 80 % de acierto (con 40 casos el intervalo es de unos ±12 puntos).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--score")
    a = ap.parse_args()
    eps = json.loads((HERE / "out" / "graph.json").read_text())["episodes"]
    if a.score:
        score(eps, json.loads(Path(a.score).read_text()))
    else:
        cases = sample(eps)
        (HERE / "out" / "validate.html").write_text(PAGE.replace("__CASES__", "\n".join(case(e, i + 1) for i, e in enumerate(cases))))
        print(f"out/validate.html con {len(cases)} casos: {dict(Counter(e['verdict'] for e in cases))}")
