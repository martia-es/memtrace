"""Paso 8 del diseño: convertir los hallazgos en lecciones, y comprobar cada una antes de enseñarla.

Cómo se hace (y por qué):
  1. Se agrupan los fallos por LO QUE OCURRIÓ (paso que falla + error), no por la regla estadística: así no se
     mezclan fallos distintos ni salen lecciones duplicadas.
  2. Para cada grupo se buscan conversaciones correctas del mismo tipo de petición con las que contrastar.
  3. Si el patrón es estructural (argumento vacío, orden de herramientas, reintentos tras un 429, nº de llamadas),
     la lección sale de una PLANTILLA: determinista, sin LLM.
  4. Si no, un LLM (Gemini) lee conversaciones completas, las fallidas y las correctas, y las compara.
  5. Cada lección se prueba con conversaciones que no se usaron para crearla: ¿habría evitado el fallo?
     ¿habría estropeado una conversación correcta? Solo cuenta como verificada si pasa las dos pruebas.

Solo se envían datos sintéticos del spike. La clave se lee del entorno y nunca se imprime.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from discover import CITIES, MODEL as EMBED_MODEL

HERE = Path(__file__).parent
OUT = HERE / "out"
MODEL = os.environ.get("DISTILL_MODEL", "gemini-2.5-flash")
PAUSE_BETWEEN_CALLS = 6  # segundos: evita el límite de peticiones por minuto de las claves gratuitas
MIN_FAIL = 25  # fallos mínimos para considerar un grupo (como MIN_SUPPORT de discover.py)
SHOWN_FAIL, SHOWN_OK, HELD_FAIL, HELD_OK = 3, 3, 5, 5
MIN_AVOID, MAX_HARM = 0.6, 0.2
DUPLICATE_COSINE = 0.8

WRITE_SYSTEM = """You write one short, actionable lesson for an AI agent by comparing conversations where it FAILED with
conversations where it did well on similar requests. Read the steps, arguments, tool results and final answers.
Find what the failing conversations did, or omitted, that the good ones did not, and cite it (step numbers or the
answer text). Do not invent causes the transcripts do not show: if they do not show the cause, set
insufficient_evidence to true and say what is missing. The guidance must be ONE imperative sentence (max 30 words)
that the agent can follow and a person can check. Write every text value in Spanish.
Answer with JSON only (keys in English):
{"insufficient_evidence": bool, "evidence": str, "when": str, "failure": str, "guidance": str, "confidence": "high"|"medium"|"low"}"""

JUDGE_SYSTEM = """You judge a lesson for an AI agent using only the transcripts given. The lesson would be placed in the agent's
prompt. For each FAILED conversation decide whether an agent that followed the lesson would have avoided that failure.
For each OK conversation decide whether following the lesson would have made the agent behave worse or wrongly there.
Answer with JSON only: {"avoids": [bool, ...one per failed conversation], "harms": [bool, ...one per ok conversation]}"""


def load_env():
    """Lee spikes/mem/.env (ignorado por git) si existe; el entorno manda sobre el fichero."""
    p = HERE / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")


def call_llm(system: str, prompt: str) -> dict:
    load_env()
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
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
    time.sleep(PAUSE_BETWEEN_CALLS)
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


# ---------- conversaciones legibles ----------

def transcript(r) -> str:
    a = r.attrs
    lines = []
    for s in r.step_log:
        if s["name"] == "chat":
            t = "llamada al modelo"
            if s["status"] == "STATUS_CODE_ERROR":
                t += f" -> ERROR {s['msg']}"
            if s["answer"]:
                t += f" -> responde: «{s['answer']}»"
        else:
            t = f"{s['name']}({s['args']})"
            t += f" -> ERROR {s['msg']}" if s["status"] == "STATUS_CODE_ERROR" else f" -> {s['result']}"
        lines.append(t)
    collapsed, i = [], 0
    while i < len(lines):  # los bucles de reintentos se resumen: «… (×12)»
        j = i
        while j < len(lines) and lines[j] == lines[i]:
            j += 1
        collapsed.append(lines[i] + (f" (×{j - i})" if j - i > 1 else ""))
        i = j
    state = {"failed": "FALLO", "ok": "correcta", "suspect": "dudosa"}[r.outcome]
    head = f"[idioma={a.get('user.lang')}, modelo={a.get('gen_ai.request.model')}, prompt v{a.get('prompt.version')}]"
    return "\n".join([head, f"Usuario: {r.goal}"] + [f"{n}. {t}" for n, t in enumerate(collapsed, 1)] + [f"Resultado: {state}"])


# ---------- agrupar fallos por lo que ocurrió ----------

def cause_key(r) -> str:
    return f"{r.decisive_step} | {r.decisive_error}" if r.has_error else "(sin error)"


def candidates(df: pd.DataFrame, findings: list[dict]) -> list[dict]:
    """Un candidato por causa. Los fallos con error se unen entre hallazgos; los silenciosos van por hallazgo."""
    found: dict[str, dict] = {}
    for fi, f in enumerate(findings):
        m = df[df.trace_id.isin(f["members"]) & (df.outcome == "failed")]
        if m.empty:
            continue
        for ck, g in m.groupby(m.apply(cause_key, axis=1)):
            if len(g) < MIN_FAIL:
                continue
            key = ck if ck != "(sin error)" else f"(sin error) #{fi}"
            c = found.setdefault(key, {"cause": ck, "ids": set(), "findings": []})
            c["ids"] |= set(g.trace_id)
            c["findings"].append(fi)
    return sorted(found.values(), key=lambda c: -len(c["ids"]))


def contrast_pool(df: pd.DataFrame, failed: pd.DataFrame) -> pd.DataFrame:
    """Conversaciones correctas del mismo tipo de petición que las fallidas."""
    clusters = failed["goal_cluster"].value_counts().head(2).index
    return df[(df.outcome == "ok") & df.goal_cluster.isin(clusters)]


def sample(df: pd.DataFrame, n: int, avoid: set | None = None) -> pd.DataFrame:
    df = df[~df.trace_id.isin(avoid or set())]
    return df.sample(min(n, len(df)), random_state=0)


# ---------- plantillas (sin LLM) ----------

def safe_json(s: str) -> dict:
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def template(G: pd.DataFrame, P: pd.DataFrame) -> dict | None:
    """Patrones estructurales que se resuelven con una frase fija. Devuelve None si no encaja ninguna."""
    n = len(G)
    err = G.decisive_error.mode().iat[0] if G.has_error.any() else ""
    tool = G.decisive_step.mode().iat[0] if G.has_error.any() else ""

    empties = Counter(k for a in G.decisive_args for k, v in safe_json(a).items() if v in ("", None))
    if empties and sum(empties.values()) >= 0.8 * n:
        key = empties.most_common(1)[0][0]
        return {"when": f"Antes de llamar a {tool}", "failure": f"se llama con «{key}» vacío y falla con «{err}»",
                "guidance": f"No llames a {tool} con «{key}» vacío; si el usuario no lo ha dado, pregúntaselo antes.",
                "evidence": f"En el {round(100 * sum(empties.values()) / n)} % de los fallos el argumento «{key}» iba vacío.",
                "confidence": "high"}

    if re.search(r"429|quota|rate.?limit|too many requests", err, re.I) and G["loop"].mean() >= 0.5:
        return {"when": f"Cuando {tool} devuelve «{err}»", "failure": "el agente reintenta una y otra vez sin esperar",
                "guidance": "Si el servicio devuelve un error de cuota, espera entre intentos, para tras 2 reintentos y avisa al usuario de que lo intente más tarde.",
                "evidence": f"El {round(100 * G['loop'].mean())} % de estos fallos son bucles de {int(G.n_chat.median())} o más llamadas al modelo.",
                "confidence": "high"}

    if len(P) >= 20:
        gseq = G.tools.mode().iat[0]
        if (G.tools == gseq).mean() >= 0.7:
            gtools = gseq.split(">")
            for pseq, share in (P.tools.value_counts(normalize=True)).items():
                if share < 0.1 or pseq == gseq:
                    continue
                ptools = pseq.split(">")
                if sorted(ptools) == sorted(gtools):
                    return {"when": "Cuando hay que usar varias herramientas en la misma petición",
                            "failure": f"se usan en el orden «{gseq.replace('>', ' → ')}»",
                            "guidance": f"Llama a las herramientas en este orden: {' → '.join(ptools)}.",
                            "evidence": f"El {round(100 * share)} % de las conversaciones correctas del mismo tipo siguen «{pseq}»; las fallidas siguen «{gseq}».",
                            "confidence": "medium"}
                extra = Counter(ptools) - Counter(gtools)
                if extra and set(ptools) >= set(gtools):
                    t, m = extra.most_common(1)[0]
                    return {"when": "Cuando la petición implica varios elementos (por ejemplo, dos ciudades)",
                            "failure": f"se llama a {t} menos veces de las necesarias, sin dar error",
                            "guidance": f"Llama a {t} una vez por cada elemento que pida el usuario.",
                            "evidence": f"En las conversaciones correctas del mismo tipo se llama a {t} {Counter(ptools)[t]} veces; en las fallidas, {Counter(gtools)[t]}.",
                            "confidence": "medium"}
    return None


# ---------- LLM y verificación ----------

def block(rows: pd.DataFrame) -> str:
    return "\n\n".join(f"--- {i}\n{transcript(r)}" for i, r in enumerate(rows.itertuples(), 1))


def write_with_llm(shown_fail: pd.DataFrame, shown_ok: pd.DataFrame, total_fail: int) -> dict:
    prompt = (f"FAILED conversations (showing {len(shown_fail)} of {total_fail}):\n{block(shown_fail)}\n\n"
              f"OK conversations of similar requests (showing {len(shown_ok)}):\n{block(shown_ok)}")
    return call_llm(WRITE_SYSTEM, prompt)


def verify(lesson: dict, held_fail: pd.DataFrame, held_ok: pd.DataFrame) -> dict:
    if held_fail.empty:
        return {"status": "sin datos"}
    prompt = (f"LESSON: {lesson['guidance']}\n(applies when: {lesson['when']})\n\n"
              f"FAILED conversations:\n{block(held_fail)}\n\nOK conversations:\n{block(held_ok) if len(held_ok) else '(none)'}")
    res = call_llm(JUDGE_SYSTEM, prompt)
    avoids = [bool(x) for x in res.get("avoids", [])][:len(held_fail)]
    harms = [bool(x) for x in res.get("harms", [])][:len(held_ok)]
    a = sum(avoids) / max(len(held_fail), 1)
    h = sum(harms) / len(held_ok) if len(held_ok) else 0.0
    return {"avoids": sum(avoids), "of_fail": len(held_fail), "harms": sum(harms), "of_ok": len(held_ok),
            "status": "verificada" if a >= MIN_AVOID and h <= MAX_HARM else "no verificada"}


def drop_duplicates(lessons: list[dict]) -> list[dict]:
    """Dos lecciones con casi la misma instrucción son una: se queda la que tiene más fallos."""
    from sentence_transformers import SentenceTransformer

    live = [l for l in lessons if l.get("guidance")]
    if len(live) < 2:
        return lessons
    emb = SentenceTransformer(EMBED_MODEL).encode([l["guidance"] for l in live], normalize_embeddings=True, show_progress_bar=False)
    cos = emb @ emb.T
    dropped = set()
    for i in sorted(range(len(live)), key=lambda i: -live[i]["failures"]):
        if i in dropped:
            continue
        for j in range(len(live)):
            if j != i and j not in dropped and cos[i, j] >= DUPLICATE_COSINE:
                dropped.add(j)
                live[i]["failures"] += live[j]["failures"]
                live[i].setdefault("merged", []).append(live[j]["when"])
    gone = {id(live[j]) for j in dropped}
    return [l for l in lessons if id(l) not in gone]


def main():
    findings = json.loads((OUT / "findings.json").read_text())["findings"]
    df = pd.read_pickle(OUT / "episodes_clustered.pkl")
    lessons = []
    for c in candidates(df, findings):
        G = df[df.trace_id.isin(c["ids"])]
        P = contrast_pool(df, G)
        shown_fail = sample(G, SHOWN_FAIL)
        # entre las correctas se prefieren las que hicieron algo distinto a las fallidas
        gseq = G.tools.mode().iat[0]
        different = P[P.tools != gseq]
        shown_ok = sample(different if len(different) >= SHOWN_OK else P, SHOWN_OK)
        held_fail = sample(G, HELD_FAIL, set(shown_fail.trace_id))
        held_ok = sample(P, HELD_OK, set(shown_ok.trace_id))

        item = {"cause": c["cause"], "failures": len(G), "source": "plantilla"}
        try:
            les = template(G, P)
            if les is None:
                item["source"] = "LLM"
                les = write_with_llm(shown_fail, shown_ok, len(G))
            item.update(les)
            if item.get("insufficient_evidence"):
                item["verification"] = {"status": "sin evidencia"}
            else:
                item["verification"] = verify(item, held_fail, held_ok)
        except Exception as e:  # una cuota agotada no debe tumbar el resto
            item["error"] = f"{type(e).__name__}: {str(e)[:120]}"
        item["example_fail"] = transcript(next(shown_fail.itertuples()))
        if len(shown_ok):
            item["example_ok"] = transcript(next(shown_ok.itertuples()))
        lessons.append(item)
        print(f"{c['cause'][:50]:50} fallos={len(G):4} {item['source']:9} -> {item.get('verification', {}).get('status', item.get('error'))}", flush=True)

    lessons = drop_duplicates(lessons)
    (OUT / "lessons.json").write_text(json.dumps(lessons, indent=1, ensure_ascii=False))

    md = ["# Lecciones para valorar", "",
          "Pon una nota del 1 al 5 en cada criterio: **Claridad** (¿se entiende?), **Corrección** (¿parece cierta con la evidencia?) y **Aplicabilidad** (¿se la podrías dar a un agente real?).", "",
          "«Verificada» significa que un segundo LLM, con conversaciones que no se usaron para escribirla, juzgó que la lección habría evitado al menos el 60 % de los fallos y no habría estropeado más del 20 % de las correctas. Es un juicio, no una prueba: la prueba real es repetir las conversaciones con la lección puesta.", ""]
    for n, l in enumerate(lessons, 1):
        md += [f"## Lección {n}", ""]
        if "error" in l:
            md += [f"(no se pudo redactar: {l['error']})", ""]
            continue
        v = l.get("verification", {})
        if l.get("insufficient_evidence"):
            md += [f"**Sin evidencia suficiente** ({l['failures']} fallos). El LLM dice que las conversaciones no muestran la causa: {l.get('evidence', '')}", ""]
        else:
            check = (f"{v['status']}: evitaría {v['avoids']} de {v['of_fail']} fallos retenidos y estropearía {v['harms']} de {v['of_ok']} correctas"
                     if "avoids" in v else v.get("status", ""))
            md += [f"- **Cuándo**: {l['when']}", f"- **Qué falla**: {l['failure']}", f"- **Qué hacer**: {l['guidance']}",
                   f"- **Evidencia**: {l.get('evidence', '')}", f"- **Origen**: {l['source']} · {l['failures']} conversaciones fallidas · confianza {l.get('confidence', '')}",
                   f"- **Verificación**: {check}"]
            if l.get("merged"):
                md += [f"- **Fusionada con**: {'; '.join(l['merged'])}"]
            md += [""]
        md += ["Una conversación que falló:", "```", l["example_fail"], "```"]
        if l.get("example_ok"):
            md += ["Una correcta del mismo tipo:", "```", l["example_ok"], "```"]
        md += ["", "| Claridad | Corrección | Aplicabilidad | Comentario |", "|---|---|---|---|", "|  |  |  |  |", "",
               f"<sub>Causa agrupada por: `{l['cause']}`</sub>", ""]
    (OUT / "lessons_for_review.md").write_text("\n".join(md))


if __name__ == "__main__":
    main()
