"""Genera trazas sintéticas de un agente del tiempo con fallos sembrados (ver README).

Las filas de spans siguen las columnas de `memtrace.otel_traces` que usa el diseño de Mem.
Sin LLM ni red: es determinista dado --seed.
"""
import argparse
import json
import random
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

CAPITALS = ["Madrid", "Paris", "London", "Rome", "Berlin", "Lisbon"]
NON_CAPITALS = ["Girona", "Bilbao", "Porto", "Lyon", "Turin", "Leeds"]

# plantillas por intención y idioma; {c} y {d} son ciudades
MESSAGES = {
    "weather_today": {
        "en": ["What is the weather like in {c} today?", "How's the weather in {c} right now?", "Tell me today's conditions in {c}", "Is it sunny in {c} today?"],
        "es": ["¿Qué tiempo hace hoy en {c}?", "¿Cómo está el clima en {c} ahora mismo?", "Dime las condiciones de hoy en {c}", "¿Hace sol hoy en {c}?"],
    },
    "forecast_week": {
        "en": ["Give me the forecast for {c} for the next week", "What will the weather be in {c} over the next seven days?", "I need the weekly forecast for {c}"],
        "es": ["Dame la previsión de {c} para la próxima semana", "¿Qué tiempo hará en {c} los próximos siete días?", "Necesito la previsión semanal de {c}"],
    },
    "compare_cities": {
        "en": ["Is it warmer in {c} or in {d}?", "Which is hotter right now, {c} or {d}?", "Compare the temperature in {c} and {d}"],
        "es": ["¿Hace más calor en {c} o en {d}?", "¿Cuál está más caliente ahora, {c} o {d}?", "Compara la temperatura de {c} y {d}"],
    },
    "clothing_advice": {
        "en": ["What should I wear in {c} tomorrow?", "Do I need a jacket in {c} tomorrow?", "Help me pack for {c} tomorrow"],
        "es": ["¿Qué ropa me pongo mañana en {c}?", "¿Necesito chaqueta mañana en {c}?", "Ayúdame a preparar la maleta para {c} mañana"],
    },
    "no_city": {
        "en": ["Will it rain tomorrow?", "Do I need an umbrella tomorrow?", "Is it going to be cold this weekend?"],
        "es": ["¿Va a llover mañana?", "¿Necesito paraguas mañana?", "¿Va a hacer frío este fin de semana?"],
    },
}
INTENT_WEIGHTS = {"weather_today": 40, "forecast_week": 25, "compare_cities": 12, "clothing_advice": 13, "no_city": 10}

SKY = {"en": ["sunny", "cloudy", "rainy"], "es": ["soleado", "nublado", "lluvioso"]}


def temp_c(city: str) -> int:
    return 8 + zlib.crc32(city.encode()) % 20


def sky(city: str, lang: str) -> str:
    return SKY[lang][zlib.crc32(city[::-1].encode()) % 3]


def weather_answer(city, lang, fahrenheit=False):
    t = temp_c(city)
    temp = f"{round(t * 9 / 5 + 32)} °F" if fahrenheit else f"{t} °C"
    return f"It is {temp} and {sky(city, lang)} in {city}." if lang == "en" else f"Hoy en {city} hay {temp} y está {sky(city, lang)}."


def compare_answer(city, other, lang, only_one=False):
    if only_one:
        return weather_answer(city, lang)
    tc, to = temp_c(city), temp_c(other)
    warmer, colder = (city, other) if tc >= to else (other, city)
    if lang == "en":
        return f"{warmer} is warmer ({max(tc, to)} °C vs {min(tc, to)} °C in {colder})."
    return f"En {warmer} hace más calor ({max(tc, to)} °C frente a {min(tc, to)} °C en {colder})."


DAYS = 30
PROMPT_CHANGE_DAY = 15  # F7
MODEL_B_FROM_DAY = 10  # F5


class Builder:
    def __init__(self, rnd: random.Random, trace_id: str, start: datetime, attrs: dict):
        self.rnd = rnd
        self.trace_id = trace_id
        self.t = start
        self.attrs = attrs
        self.rows: list[dict] = []

    def span(self, name, parent, ms, status="STATUS_CODE_OK", message="", exc_type="", exc_msg="", extra=None):
        sid = uuid.UUID(int=self.rnd.getrandbits(128)).hex[:16]
        start = self.t
        self.t = self.t + timedelta(milliseconds=ms)
        row = {
            "Timestamp": start.isoformat(),
            "DurationMs": ms,
            "TraceId": self.trace_id,
            "SpanId": sid,
            "ParentSpanId": parent or "",
            "SpanName": name,
            "StatusCode": status,
            "StatusMessage": message,
            "ExceptionType": exc_type,
            "ExceptionMessage": exc_msg,
            "SpanAttributes": {**self.attrs, **(extra or {})},
        }
        self.rows.append(row)
        return sid


def pick_intent(rnd):
    return rnd.choices(list(INTENT_WEIGHTS), weights=list(INTENT_WEIGHTS.values()))[0]


def make_trace(rnd: random.Random, base: datetime, day: int):
    lang = rnd.choices(["en", "es"], weights=[55, 45])[0]
    intent = pick_intent(rnd)
    model = "model_b" if day >= MODEL_B_FROM_DAY and rnd.random() < 0.4 else "model_a"
    prompt_version = 1 if day < PROMPT_CHANGE_DAY else 2
    city = rnd.choice(CAPITALS + NON_CAPITALS)
    other = rnd.choice([c for c in CAPITALS + NON_CAPITALS if c != city])
    message = rnd.choice(MESSAGES[intent][lang]).format(c=city, d=other)
    trace_id = uuid.UUID(int=rnd.getrandbits(128)).hex
    start = base + timedelta(seconds=rnd.randrange(86400))
    attrs = {
        "user.message": message,
        "user.lang": lang,
        "gen_ai.request.model": model,
        "prompt.version": str(prompt_version),
        "enduser.id": f"user-{rnd.randrange(400)}",
    }
    b = Builder(rnd, trace_id, start, attrs)
    modes: list[str] = []
    root = b.span("conversation_turn", None, 0)
    agent = b.span("invoke_agent agent", root, 0)

    def tool(name, args, fail=None, result=None):
        """fail = (status_message, exception_type) o None."""
        if fail is None and rnd.random() < 0.02:  # F6: ruido transitorio
            fail = ("Connection reset by peer", "ConnectionResetError")
            modes.append("F6")
        if fail:
            b.span(f"execute_tool {name}", agent, rnd.randint(30, 400), "STATUS_CODE_ERROR", fail[0], fail[1], fail[0],
                   {"tool.name": name, "tool.args": json.dumps(args)})
            return False
        b.span(f"execute_tool {name}", agent, rnd.randint(30, 400), "STATUS_CODE_OK",
               extra={"tool.name": name, "tool.args": json.dumps(args), "tool.result": json.dumps(result or {}, ensure_ascii=False)})
        return True

    def chat(status="STATUS_CODE_OK", message="", exc_type="", answer=None):
        b.span(f"chat {model}", agent, rnd.randint(300, 1500), status, message, exc_type, message,
               {"gen_ai.completion": answer} if answer else None)

    def geo(c):
        return {"lat": round(30 + zlib.crc32(c.encode()) % 3000 / 100, 2), "lon": round(zlib.crc32(c[::-1].encode()) % 2000 / 100, 2)}

    def fc(c):
        return {"temp_c": temp_c(c), "conditions": sky(c, "en")}

    silent_wrong = False
    errored = False
    answer = None

    # F2: bucle de reintentos tras un 429 (cualquier intención)
    if rnd.random() < 0.03:
        modes.append("F2")
        for _ in range(rnd.randint(3, 17)):
            chat("STATUS_CODE_ERROR", "status_code: 429, You exceeded your current quota", "ModelHTTPError")
        errored = True
    else:
        chat()
        if intent == "no_city":
            p_fail = 0.8 if prompt_version == 1 else 0.1  # F1 y F7
            if rnd.random() < p_fail:
                modes.append("F1")
                errored = not tool("get_forecast", {"city": ""}, ("city must not be empty", "ValueError"))
            else:
                chat(answer="Which city do you mean?" if lang == "en" else "¿De qué ciudad hablas?")  # el agente pregunta por la ciudad
        elif intent == "compare_cities":
            tool("geocode", {"city": city}, result=geo(city))
            tool("get_forecast", {"city": city}, result=fc(city))
            if rnd.random() < 0.85:  # F3: se olvida de la segunda ciudad, sin error
                modes.append("F3")
                silent_wrong = True
                answer = compare_answer(city, other, lang, only_one=True)
            else:
                tool("get_forecast", {"city": other}, result=fc(other))
                answer = compare_answer(city, other, lang)
        else:
            wrong_order = intent == "forecast_week" and city in NON_CAPITALS and rnd.random() < 0.6
            if wrong_order:  # F4
                modes.append("F4")
                ok = tool("get_forecast", {"city": city}, ("LocationNotFound: city not found", "LocationNotFound") if rnd.random() < 0.8 else None,
                          result=fc(city))
                errored = not ok
                tool("geocode", {"city": city}, result=geo(city))
            else:
                tool("geocode", {"city": city}, result=geo(city))
                tool("get_forecast", {"city": city}, result=fc(city))
            answer = weather_answer(city, lang)
            if lang == "es" and model == "model_b" and rnd.random() < 0.7:  # F5: unidades mal, sin error
                modes.append("F5")
                silent_wrong = True
                answer = weather_answer(city, lang, fahrenheit=True)
        if not errored:
            chat(answer=answer)

    # cierre de spans padre: heredan el error del hijo más profundo, como en la realidad
    if errored:
        for row in b.rows[:2]:
            row["StatusCode"] = "STATUS_CODE_ERROR"
            row["StatusMessage"] = next(r["StatusMessage"] for r in b.rows if r["StatusCode"] == "STATUS_CODE_ERROR")
    true_failure = bool(set(modes) & {"F1", "F2", "F3", "F4", "F5"})
    return trace_id, b.rows, modes, true_failure, silent_wrong, errored, intent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--traces", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data"))
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)

    spans, feedback, scores, truth = [], [], [], {}
    for i in range(args.traces):
        day = min(DAYS - 1, i * DAYS // args.traces)
        trace_id, rows, modes, failed, silent, errored, intent = make_trace(rnd, t0 + timedelta(days=day), day)
        spans.extend(rows)
        # feedback del usuario y evaluador, con ruido
        if failed and silent:
            if rnd.random() < 0.55:
                feedback.append({"TraceId": trace_id, "thumbs": "down"})
            scores.append({"TraceId": trace_id, "evaluator": "correctness", "score": 0 if rnd.random() < 0.7 else 1})
        elif failed:
            if rnd.random() < 0.3:
                feedback.append({"TraceId": trace_id, "thumbs": "down"})
            scores.append({"TraceId": trace_id, "evaluator": "correctness", "score": 0 if rnd.random() < 0.9 else 1})
        else:
            if rnd.random() < 0.15:
                feedback.append({"TraceId": trace_id, "thumbs": "up" if rnd.random() < 0.93 else "down"})
            if rnd.random() < 0.6:  # el evaluador no corre sobre todo
                scores.append({"TraceId": trace_id, "evaluator": "correctness", "score": 1 if rnd.random() < 0.97 else 0})
        truth[trace_id] = {"modes": modes, "failed": failed, "day": day, "intent": intent}

    def dump(name, rows):
        with open(out / name, "w") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    dump("spans.jsonl", spans)
    dump("feedback.jsonl", feedback)
    dump("eval_scores.jsonl", scores)
    (out / "ground_truth.json").write_text(json.dumps(truth))

    counts: dict[str, int] = {}
    for t in truth.values():
        for m in set(t["modes"]):
            counts[m] = counts.get(m, 0) + 1
    print(f"{args.traces} trazas, {len(spans)} spans, {len(feedback)} feedback, {len(scores)} puntuaciones")
    print("trazas por modo sembrado:", dict(sorted(counts.items())))
    print("trazas con fallo real:", sum(1 for t in truth.values() if t["failed"]))


if __name__ == "__main__":
    main()
