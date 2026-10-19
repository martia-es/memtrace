"""Paso 8 del diseño: redactar una lección por hallazgo con el LLM del usuario (aquí, Gemini con GEMINI_API_KEY).

Solo se envían datos sintéticos del spike. La clave se lee del entorno y nunca se imprime.
"""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "out"
MODEL = os.environ.get("DISTILL_MODEL", "gemini-2.5-flash")

SYSTEM = """You write short, actionable lessons for an AI agent from evidence about its recurring failures.
Rules: describe the trigger situation, what goes wrong, and what the agent should do instead. Be specific and
checkable. Do not invent causes the evidence does not support; if the evidence only shows a correlation, say so
and keep the advice conservative. Never copy user messages verbatim. Answer with JSON only:
{"when": str, "failure": str, "guidance": str, "scope": str, "confidence": "high"|"medium"|"low", "caveat": str}"""


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


def evidence(df: pd.DataFrame, f: dict) -> str:
    members = df[df.trace_id.isin(f["members"])]
    failed, ok = members[members.outcome == "failed"], members[members.outcome == "ok"]
    ex_fail = failed["goal"].drop_duplicates().head(4).tolist()
    ex_ok = ok["goal"].drop_duplicates().head(3).tolist()
    seq_fail = failed["tools"].value_counts().head(2).to_dict()
    seq_ok = ok["tools"].value_counts().head(2).to_dict()
    return json.dumps({
        "condition_found_by_analysis": f["rule"],
        "traces_matching": f["support"],
        "share_of_matching_traces_that_failed": f["failure_rate"],
        "overall_failure_rate_for_comparison": None,
        "where_it_breaks": {"step": f["decisive_step"], "error": f["decisive_error"], "arguments": f["decisive_args"]},
        "tool_sequences_in_failures": seq_fail,
        "tool_sequences_in_successes_with_same_condition": seq_ok,
        "example_goals_that_failed": ex_fail,
        "example_goals_that_succeeded": ex_ok,
        "occurrence_per_100_traces_by_prompt_version": f["occurrence_per_100_traces_by_prompt_version"],
        "note": "goal_cluster=N are anonymous clusters of similar user requests; they are not labels",
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
        print(f"#{i} {f['rule'][:60]} -> {'OK' if 'error' not in lesson else lesson['error']}")
    (OUT / "lessons.json").write_text(json.dumps(lessons, indent=1, ensure_ascii=False))

    md = ["# Lecciones para valorar", "",
          "Pon una nota del 1 al 5 en cada criterio: **Claridad** (¿se entiende?), **Corrección** (¿parece cierta con la evidencia?) y **Aplicabilidad** (¿se la podrías dar a un agente real?).", ""]
    for item in lessons:
        md += [f"## Lección {item['finding'] + 1}", f"*Regla detectada*: `{item['rule']}`  ·  *trazas*: {item['support']}", ""]
        les = item["lesson"]
        if "error" in les:
            md += [f"(no se pudo redactar: {les['error']})", ""]
            continue
        md += [f"- **Cuándo**: {les.get('when')}", f"- **Qué falla**: {les.get('failure')}", f"- **Qué hacer**: {les.get('guidance')}",
               f"- **Ámbito**: {les.get('scope')}", f"- **Confianza**: {les.get('confidence')}", f"- **Salvedad**: {les.get('caveat')}", "",
               "| Claridad | Corrección | Aplicabilidad | Comentario |", "|---|---|---|---|", "|  |  |  |  |", ""]
    (OUT / "lessons_for_review.md").write_text("\n".join(md))


if __name__ == "__main__":
    main()
