"""Prueba de efecto: ¿una lección, puesta en el prompt de un agente real, corrige el fallo y no estropea nada más?

Agente de laboratorio:
  - Un LLM real (Groq por defecto, o Gemini con APPLY_PROVIDER=gemini; modelo con APPLY_MODEL) con dos herramientas simuladas: geocode(city) y get_forecast(city).
  - Su prompt «v1» lleva cinco defectos puestos a propósito (reglas malas), uno por fallo que descubrió el spike.
    Es un montaje: el fallo lo provoca el prompt, no el modelo. Sirve para medir si la lección lo corrige.

Para cada lección se ejecutan las mismas peticiones en tres condiciones:
  A  = prompt v1 solo
  B  = prompt v1 + la lección (como entraría con `{{lessons}}`)
  C  = peticiones normales (control) con la lección: ¿la lección estropea lo que ya funcionaba?
Cada conversación se juzga con una comprobación automática (sin LLM) sobre las llamadas a herramientas y la respuesta.

Uso: uv run python apply.py [--n 12]   (reanuda lo ya ejecutado; guarda en out/apply_results.jsonl)
"""
import argparse
import json
import os
import random
import time
import unicodedata
import urllib.error
import urllib.request
import zlib
from pathlib import Path

from scipy.stats import fisher_exact

import distill
from gen_traces import CAPITALS, MESSAGES, NON_CAPITALS

HERE = Path(__file__).parent
OUT = HERE / "out"
RESULTS = OUT / "apply_results.jsonl"
distill.load_env()
PROVIDER = os.environ.get("APPLY_PROVIDER", "groq")  # groq | gemini
MODEL = os.environ.get("APPLY_MODEL") or ("openai/gpt-oss-120b" if PROVIDER == "groq" else distill.MODEL)
PAUSE = 4  # segundos entre llamadas al LLM
MAX_TURNS = 8

SYSTEM_V1 = """You are a weather assistant. Tools: geocode(city) and get_forecast(city). Rules of this deployment:
1. Call get_forecast directly with the city the user gave; use geocode only if get_forecast fails.
2. If the user does not mention a city, call get_forecast with an empty city string: the backend uses the default location.
3. To compare two cities, call get_forecast only for the first city mentioned and estimate the other, to save calls.
4. If a tool fails with a temporary error, retry the call until it works.
5. Show temperatures in °F when the user writes in Spanish, and in °C otherwise.
Answer briefly, in the user's language."""

LESSON_FRAME = "\n\nLessons learned (approved by the team; they take priority over the rules above if they conflict):\n- "

TOOLS = [{"functionDeclarations": [
    {"name": "geocode", "description": "Resolve a city name to coordinates.",
     "parameters": {"type": "OBJECT", "properties": {"city": {"type": "STRING"}}, "required": ["city"]}},
    {"name": "get_forecast", "description": "Get the current weather for a city.",
     "parameters": {"type": "OBJECT", "properties": {"city": {"type": "STRING"}}, "required": ["city"]}},
]}]


def temp_c(city: str) -> int:
    return 8 + zlib.crc32(city.encode()) % 20


class Tools:
    """Herramientas simuladas con el comportamiento que tuvieron los fallos sembrados."""

    def __init__(self, quota: bool):
        self.quota, self.geocoded, self.log = quota, set(), []

    def run(self, name: str, args: dict) -> dict:
        city = str(args.get("city", ""))
        if name == "geocode":
            self.log.append(("geocode", city))
            if not city.strip():
                return {"error": "city must not be empty"}
            self.geocoded.add(city.lower())
            return {"lat": round(30 + zlib.crc32(city.encode()) % 3000 / 100, 2), "lon": round(zlib.crc32(city[::-1].encode()) % 2000 / 100, 2)}
        self.log.append(("get_forecast", city))
        if not city.strip():
            return {"error": "city must not be empty"}
        if self.quota:
            return {"error": "429: You exceeded your current quota"}
        if city in NON_CAPITALS and city.lower() not in self.geocoded:
            return {"error": "LocationNotFound: city not found"}
        return {"temp_c": temp_c(city), "conditions": "cloudy"}


class DailyQuota(Exception):
    """Cuota diaria del proveedor agotada: no sirve reintentar; lo hecho ya está guardado y se reanuda mañana."""


def post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", "User-Agent": "memtrace-spike/0.1", **headers})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
            time.sleep(PAUSE)
            return data
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429 and ("per day" in detail.lower() or "tokens per day" in detail.lower()):
                raise DailyQuota(detail[:300]) from e
            if e.code == 400 and "tool_use_failed" in detail:  # el modelo generó una llamada mal formada
                return {"_malformed": True}
            if e.code not in (429, 500, 503) or attempt == 5:
                raise RuntimeError(f"HTTP {e.code}: {detail[:300]}") from e
            time.sleep(10 * 2 ** attempt)


def converse_gemini(request: str, system: str, quota: bool) -> tuple[list, str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    headers = {"x-goog-api-key": os.environ["GEMINI_API_KEY"]}
    tools = Tools(quota)
    contents = [{"role": "user", "parts": [{"text": request}]}]
    for _ in range(MAX_TURNS):
        data = post(url, {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "tools": TOOLS,
                          "generationConfig": {"temperature": 0.5}}, headers)
        cand = data.get("candidates", [{}])[0].get("content")
        if not cand or not cand.get("parts"):
            return tools.log, ""
        contents.append(cand)
        calls = [p["functionCall"] for p in cand["parts"] if "functionCall" in p]
        if not calls:
            return tools.log, " ".join(p.get("text", "") for p in cand["parts"])
        contents.append({"role": "user", "parts": [
            {"functionResponse": {"name": c["name"], "response": tools.run(c["name"], c.get("args", {}))}} for c in calls]})
    return tools.log, ""


def openai_tools():
    return [{"type": "function", "function": {"name": d["name"], "description": d["description"], "parameters": {
        "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}} for d in TOOLS[0]["functionDeclarations"]]


def converse_groq(request: str, system: str, quota: bool) -> tuple[list, str]:
    """Groq (API compatible con OpenAI) con tool calling."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"}
    tools = Tools(quota)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": request}]
    for _ in range(MAX_TURNS):
        data = post(url, {"model": MODEL, "messages": messages, "tools": openai_tools(), "temperature": 0.5}, headers)
        if data.get("_malformed") or not data.get("choices"):
            return tools.log, ""
        msg = data["choices"][0]["message"]
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls") and v is not None})
        if not msg.get("tool_calls"):
            return tools.log, msg.get("content") or ""
        for c in msg["tool_calls"]:
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(tools.run(c["function"]["name"], args))})
    return tools.log, ""


def converse(request: str, system: str, quota: bool) -> tuple[list, str]:
    return (converse_groq if PROVIDER == "groq" else converse_gemini)(request, system, quota)


# ---------- comprobaciones automáticas: True = el agente FALLÓ ----------

def f_order(log, text):
    names = [n for n, _ in log]
    return "get_forecast" in names and ("geocode" not in names or names.index("get_forecast") < names.index("geocode"))


def f_units(log, text):
    return "°f" in text.lower() or "fahrenheit" in text.lower()


def f_empty(log, text):
    return any(n == "get_forecast" and not c.strip() for n, c in log)


def f_compare(log, text):
    # «Girona» y «Girona, Spain» son la misma ciudad: se compara solo lo anterior a la coma
    return len({c.split(",")[0].strip().lower() for n, c in log if n == "get_forecast" and c.strip()}) < 2


def f_quota(log, text):
    return sum(n == "get_forecast" for n, _ in log) > 3 or not text.strip()


def f_control(log, text):
    t = text.lower()
    # el agente puede traducir y acentuar la ciudad («Londres», «Berlín»): se compara solo el comienzo, sin acentos
    t = "".join(ch for ch in unicodedata.normalize("NFKD", t) if not unicodedata.combining(ch))
    return not ("°c" in t and any(c.lower()[:4] in t for c in CAPITALS)) or sum(n == "get_forecast" for n, _ in log) > 2


def pick(rnd, intent, lang=None, cities=None):
    lang = lang or rnd.choice(["en", "es"])
    c = rnd.choice(cities or CAPITALS + NON_CAPITALS)
    d = rnd.choice([x for x in CAPITALS + NON_CAPITALS if x != c])
    return rnd.choice(MESSAGES[intent][lang]).format(c=c, d=d)


# nombre -> (cómo reconocer su lección en lessons.json, generador de peticiones, comprobación, ¿herramienta con cuota agotada?)
SCENARIOS = {
    "orden de herramientas": (lambda l: "LocationNotFound" in l["cause"], lambda r: pick(r, "forecast_week", cities=NON_CAPITALS), f_order, False),
    "unidades en español": (lambda l: "celsius" in l.get("guidance", "").lower(), lambda r: pick(r, "weather_today", "es"), f_units, False),
    "ciudad vacía": (lambda l: "must not be empty" in l["cause"], lambda r: pick(r, "no_city"), f_empty, False),
    "comparar ciudades": (lambda l: "cada elemento" in l.get("guidance", "") or "cada ciudad" in l.get("guidance", ""),
                          lambda r: pick(r, "compare_cities"), f_compare, False),
    "error de cuota": (lambda l: "quota" in l["cause"], lambda r: pick(r, "weather_today"), f_quota, True),
}


def control_requests(n, seed=99):
    r = random.Random(seed)
    return [pick(r, "weather_today", "en", CAPITALS) for _ in range(n)]


def load_done():
    if not RESULTS.exists():
        return {}
    return {(d["scenario"], d["cond"], d["i"]): d for d in map(json.loads, RESULTS.read_text().splitlines())}


def run_cell(done, scenario, cond, requests, system, check, quota):
    for i, req in enumerate(requests):
        if (scenario, cond, i) in done:
            continue
        for _ in range(3):  # una respuesta vacía suele ser un fallo del API, no del agente: se reintenta
            log, text = converse(req, system, quota)
            if text.strip() or check is f_quota:
                break
        invalid = not text.strip() and check is not f_quota  # sin respuesta no se puede juzgar: se excluye de las tasas
        rec = {"scenario": scenario, "cond": cond, "i": i, "request": req, "failed": bool(check(log, text)) and not invalid,
               "invalid": invalid, "model": MODEL, "calls": log, "answer": text}
        with open(RESULTS, "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        done[(scenario, cond, i)] = rec
        print(f"  {scenario[:22]:22} {cond} #{i:<2} {'FALLO' if rec['failed'] else 'ok   '} {req[:50]}", flush=True)


def rate(done, scenario, cond, n):
    rows = [done[(scenario, cond, i)]["failed"] for i in range(n)
            if (scenario, cond, i) in done and not done[(scenario, cond, i)].get("invalid")]
    return sum(rows), len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12, help="conversaciones por condición")
    n = ap.parse_args().n
    try:
        run(n)
    except DailyQuota as e:
        print(f"\nCuota diaria de {PROVIDER} agotada; lo hecho está guardado, vuelve a lanzarlo para reanudar.\n{e}")
        raise SystemExit(2)


def run(n):
    lessons = json.loads((OUT / "lessons.json").read_text())
    done = load_done()
    OUT.mkdir(exist_ok=True)

    controls = control_requests(n)
    summary = []
    for name, (match, gen, check, quota) in SCENARIOS.items():
        lesson = next((l for l in lessons if "guidance" in l and match(l)), None)
        if lesson is None:
            print(f"Sin lección para «{name}»; se omite.")
            continue
        print(f"\n== {name}: {lesson['guidance']}", flush=True)
        rnd = random.Random(zlib.crc32(name.encode()))
        reqs = [gen(rnd) for _ in range(n)]
        with_lesson = SYSTEM_V1 + LESSON_FRAME + lesson["guidance"]
        run_cell(done, name, "A", reqs, SYSTEM_V1, check, quota)
        run_cell(done, name, "B", reqs, with_lesson, check, quota)
        run_cell(done, name, "C", controls, with_lesson, f_control, False)
        run_cell(done, "control", "base", controls, SYSTEM_V1, f_control, False)
        summary.append((name, lesson, rate(done, name, "A", n), rate(done, name, "B", n), rate(done, name, "C", n), rate(done, "control", "base", n)))

    md = ["# Prueba de efecto de las lecciones", "",
          f"Agente de laboratorio con {PROVIDER} (`{MODEL}`), {n} conversaciones por condición. A = sin lección, B = con lección, "
          "Control = peticiones normales con la lección frente a sin ella. `p` es un test de Fisher unilateral.", "",
          "| Lección | Fallos sin lección | Fallos con lección | p | Control sin → con | Resultado |", "|---|---|---|---|---|---|"]
    for name, lesson, (a, na), (b, nb), (c, nc), (c0, n0) in summary:
        p = fisher_exact([[a, na - a], [b, nb - b]], alternative="greater")[1] if na and nb else 1.0
        harm = fisher_exact([[c, nc - c], [c0, n0 - c0]], alternative="greater")[1] if nc and n0 else 1.0
        ok = p < 0.05 and harm >= 0.05
        verdict = "✅ corrige y no daña" if ok else ("⚠️ corrige pero daña el control" if p < 0.05 else "❌ no se demuestra efecto")
        md.append(f"| {name} | {a}/{na} | {b}/{nb} | {p:.3f} | {c0}/{n0} → {c}/{nc} | {verdict} |")
    md += ["", "Textos probados:", ""] + [f"- **{name}**: {lesson['guidance']}" for name, lesson, *_ in summary]
    (OUT / "apply_report.md").write_text("\n".join(md) + "\n")
    print("\n" + "\n".join(md))


if __name__ == "__main__":
    main()
