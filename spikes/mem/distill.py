"""Paso 8 del diseño: redactar una lección por hallazgo con el LLM del usuario (aquí, Gemini con GEMINI_API_KEY).

Solo se envían datos sintéticos del spike. La clave se lee del entorno y nunca se imprime.
Las reglas técnicas (`count:chat <= 1.5`) se traducen a frases antes de enseñarlas a una persona o al LLM.
"""
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

from discover import CITIES

HERE = Path(__file__).parent
OUT = HERE / "out"
MODEL = os.environ.get("DISTILL_MODEL", "gemini-2.5-flash")
PAUSE_BETWEEN_CALLS = 6  # segundos: evita el límite de peticiones por minuto de claves gratuitas

SYSTEM = """You write short, actionable lessons for an AI agent from evidence about its recurring failures.
Rules: describe the trigger situation, what goes wrong, and what the agent should do instead. Be specific and
checkable. Do not invent causes the evidence does not support; if the evidence only shows a correlation, say so
and keep the advice conservative. Never copy user messages verbatim. Write every text value in Spanish.
Answer with JSON only (keys in English):
{"when": str, "failure": str, "guidance": str, "scope": str, "confidence": "high"|"medium"|"low", "caveat": str}"""

ATTR_LABELS = {"user.lang": "idioma", "gen_ai.request.model": "modelo", "prompt.version": "versión del prompt"}


def load_env():
    """Lee spikes/mem/.env (ignorado por git) si existe; el entorno manda sobre el fichero."""
    p = HERE / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")


def call_llm(prompt: str) -> dict:
    load_env()
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 503) or attempt == 5:
                raise
            time.sleep(10 * 2 ** attempt)
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def cluster_label(df: pd.DataFrame, c: int) -> str:
    """Un grupo de peticiones no tiene nombre: se describe con dos de sus mensajes, sin la ciudad."""
    goals = df[df.goal_cluster == c]["goal"].map(lambda g: re.sub(CITIES, "<ciudad>", g))
    return " / ".join(goals.value_counts().head(2).index)


def humanize_condition(df: pd.DataFrame, name: str, op: str, thr: float) -> str:
    """Traduce una condición del árbol (`nombre op umbral`) a una frase."""
    yes = op == ">"
    n = math.floor(thr)
    cmp_ = f"como mucho {n}" if op == "<=" else f"más de {n}"
    if name.startswith("goal_cluster="):
        label = cluster_label(df, int(name.split("=")[1]))
        return f"la petición es del tipo «{label}»" if yes else f"la petición no es del tipo «{label}»"
    if name.startswith("count:"):
        who = "el modelo" if name[6:] == "chat" else f"la herramienta {name[6:]}"
        return f"{who} se llama {cmp_} veces"
    if name == "n_steps":
        return f"la conversación tiene {cmp_} pasos"
    if name == "max_repeat_of_a_step":
        return f"un mismo paso se repite seguido {cmp_} veces"
    if "_before_" in name:
        a, b = name.split("_before_")
        return f"se llama a {a} antes que a {b}" if yes else f"no se llama a {a} antes que a {b}"
    if name.startswith("empty_arg:"):
        t = name.split(":")[1]
        return f"{t} se llama con un argumento vacío" if yes else f"{t} no se llama con un argumento vacío"
    if "=" in name:
        col, v = name.split("=", 1)
        label = ATTR_LABELS.get(col, col)
        return f"{label} = {v}" if yes else f"{label} distinto de {v}"
    return f"{name} {op} {thr:g}"


def humanize_rule(df: pd.DataFrame, rule: str) -> str:
    """`a AND b | c` (varias reglas fusionadas) -> frases unidas con «y» / «o»."""
    out = []
    for alt in rule.split(" | "):
        parts = []
        for cond in alt.split(" AND "):
            m = re.match(r"^(.*) (<=|>) (\S+)$", cond)
            parts.append(humanize_condition(df, m.group(1), m.group(2), float(m.group(3))) if m else cond)
        out.append(" y ".join(parts))
    return "; o bien ".join(out)


def examples(df: pd.DataFrame, f: dict) -> tuple[list[str], list[str]]:
    members = df[df.trace_id.isin(f["members"])]
    failed, ok = members[members.outcome == "failed"], members[members.outcome == "ok"]
    return failed["goal"].drop_duplicates().head(4).tolist(), ok["goal"].drop_duplicates().head(3).tolist()


def evidence(df: pd.DataFrame, f: dict) -> str:
    members = df[df.trace_id.isin(f["members"])]
    failed, ok = members[members.outcome == "failed"], members[members.outcome == "ok"]
    ex_fail, ex_ok = examples(df, f)
    return json.dumps({
        "condition_found_by_analysis": humanize_rule(df, f["rule"]),
        "traces_matching": f["support"],
        "share_of_matching_traces_that_failed": f["failure_rate"],
        "where_it_breaks": {"step": f["decisive_step"], "error": f["decisive_error"], "arguments": f["decisive_args"]},
        "tool_sequences_in_failures": failed["tools"].value_counts().head(2).to_dict(),
        "tool_sequences_in_successes_with_same_condition": ok["tools"].value_counts().head(2).to_dict(),
        "example_goals_that_failed": ex_fail,
        "example_goals_that_succeeded": ex_ok,
        "occurrence_per_100_traces_by_prompt_version": f["occurrence_per_100_traces_by_prompt_version"],
    }, ensure_ascii=False, indent=1)


def main():
    findings = json.loads((OUT / "findings.json").read_text())["findings"]
    df = pd.read_pickle(OUT / "episodes_clustered.pkl")
    lessons = []
    for i, f in enumerate(findings):
        try:
            lesson = call_llm("Evidence from trace analysis of a weather assistant agent:\n" + evidence(df, f))
        except Exception as e:  # una cuota agotada no debe tumbar el resto
            lesson = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
        lessons.append({"finding": i, "rule": f["rule"], "support": f["support"], "lesson": lesson})
        print(f"#{i} {humanize_rule(df, f['rule'])[:70]} -> {'OK' if 'error' not in lesson else lesson['error']}", flush=True)
        time.sleep(PAUSE_BETWEEN_CALLS)
    (OUT / "lessons.json").write_text(json.dumps(lessons, indent=1, ensure_ascii=False))

    md = ["# Lecciones para valorar", "",
          "Pon una nota del 1 al 5 en cada criterio: **Claridad** (¿se entiende?), **Corrección** (¿parece cierta con la evidencia?) y **Aplicabilidad** (¿se la podrías dar a un agente real?).", ""]
    for item, f in zip(lessons, findings):
        ex_fail, ex_ok = examples(df, f)
        md += [f"## Lección {item['finding'] + 1}", "",
               f"**Patrón detectado**: {humanize_rule(df, f['rule'])}", "",
               f"**Evidencia**: {f['support']} conversaciones cumplen el patrón; fallaron el {round(100 * f['failure_rate'])} %.", "",
               "Peticiones que fallaron: " + " · ".join(f"«{g}»" for g in ex_fail[:3]),
               "Peticiones que funcionaron: " + (" · ".join(f"«{g}»" for g in ex_ok[:2]) or "(ninguna con este patrón)"), ""]
        les = item["lesson"]
        if "error" in les:
            md += [f"(no se pudo redactar: {les['error']})", ""]
            continue
        md += [f"- **Cuándo**: {les.get('when')}", f"- **Qué falla**: {les.get('failure')}", f"- **Qué hacer**: {les.get('guidance')}",
               f"- **Ámbito**: {les.get('scope')}", f"- **Confianza**: {les.get('confidence')}", f"- **Salvedad**: {les.get('caveat')}", "",
               "| Claridad | Corrección | Aplicabilidad | Comentario |", "|---|---|---|---|", "|  |  |  |  |", "",
               f"<sub>Regla técnica: `{item['rule']}`</sub>", ""]
    (OUT / "lessons_for_review.md").write_text("\n".join(md))


if __name__ == "__main__":
    main()
