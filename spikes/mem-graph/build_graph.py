"""Construye el grafo de entidades y pasos a partir de los spans exportados (`data/spans.jsonl`) -> `out/graph.json`.

Capa 1 (sin LLM, desde la estructura del span): episodio, pasos (LLM y herramienta), herramienta, argumentos, modelo, errores.
Capa 2 (aquí con reglas, placeholder de un LLM ligero): intención y entidades del mensaje del usuario (ciudad, idioma, unidad).
Señales: comprobaciones deterministas que cruzan texto y estructura (p. ej. «el usuario nombró 2 ciudades y solo se consultó 1»).
No hay etiqueta de éxito o fallo: las señales son pistas, no veredictos.

  python build_graph.py
"""
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx

HERE = Path(__file__).parent
CITIES = ["Madrid", "Sevilla", "Barcelona", "Valencia", "Bilbao", "Zaragoza", "Málaga", "Granada", "Turín", "París", "Londres",
          "Lisboa", "Narnia", "Gotham", "Villabajo del Mar", "Springfield", "Ciudad Real", "Santiago"]


def norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))


CITY_BY_NORM = {norm(c): c for c in CITIES}
# El modelo pasa a la herramienta el nombre en inglés: sin resolver alias, «Londres» y «London» serían dos ciudades.
ALIASES = {"london": "londres", "paris": "paris", "turin": "turin", "lisbon": "lisboa", "seville": "sevilla", "saragossa": "zaragoza"}
REFUSAL = r"no dispongo|lo siento|no puedo|no tengo|sorry|cannot|can.t|solo llega|no se encontr"


def canon(city: str) -> str:
    n = norm(city)
    return ALIASES.get(n, n)
# Orden = prioridad. Reglas sobre texto sin tildes; sustituibles por un LLM sin cambiar el resto.
INTENT_RULES = [
    ("injection", r"ignora tus instrucciones|ignore your instructions|prompt del sistema|system prompt"),
    ("greeting", r"^(hola|gracias|hello|thanks)\W*$"),
    ("air_quality", r"\baire\b|air quality|calidad del aire"),
    ("pollen_uv", r"polen|pollen|\buv\b"),
    ("follow_up", r"^\W*(y |and what about)"),
    ("forecast", r"llover|lluvia|\brain|previsi|semana|manana|weekend|fin de semana|paraguas|tomorrow"),
    ("current", r"tiempo|weather|temperatura|temperature|calor|grados|quel temps|chaqueta"),
]
WEATHER_INTENTS = {"current", "forecast", "compare", "air_quality", "pollen_uv"}


def user_texts(input_messages: str) -> list[str]:
    try:
        msgs = json.loads(input_messages)
    except ValueError:
        return []
    return [p["content"] for m in msgs if m.get("role") == "user" for p in m.get("parts", []) if p.get("type") == "text" and p.get("content")]


def cities_in(text: str) -> list[str]:
    t = norm(text)
    return [c for n, c in CITY_BY_NORM.items() if re.search(rf"\b{re.escape(n)}\b", t)]


def intent_of(text: str, n_cities: int) -> str:
    t = norm(text)
    if n_cities >= 2:
        return "compare"
    for name, rx in INTENT_RULES:
        if re.search(rx, t):
            return name
    return "other"


def language_of(text: str) -> str:
    t = norm(text)
    if re.search(r"\b(quel|temps|il|fait)\b", t):
        return "fr"
    return "en" if re.search(r"\b(what|weather|will|the|is|how|which|in)\b", t) and not re.search(r"[¿¡]|\bque\b|\bhace\b", t) else "es"


def tool_failed(result: str) -> bool:
    r = result.lower()
    return not r.strip() or '"error"' in r or "'error'" in r or "not found" in r or "no se encontr" in r


def episodes() -> list[dict]:
    by_trace = defaultdict(list)
    for line in (HERE / "data" / "spans.jsonl").read_text().splitlines():
        s = json.loads(line)
        by_trace[s["TraceId"]].append(s)
    turn_of, seen = {}, Counter()
    out = []
    for tid, spans in sorted(by_trace.items(), key=lambda kv: min(s["ts"] for s in kv[1])):
        spans.sort(key=lambda s: s["ts"])
        session = spans[0]["ConversationId"]
        turn_of[tid] = seen[session]
        seen[session] += 1
        chats = [s for s in spans if s["SpanName"].startswith("chat ")]
        history = user_texts(chats[0]["input_messages"]) if chats else []
        text = history[-1] if history else ""
        cur_cities = cities_in(text)
        ctx_cities = sorted({c for h in history for c in cities_in(h)})
        steps = []
        for s in spans:
            if s["SpanName"].startswith("chat "):
                steps.append({"kind": "llm", "label": "LLM", "tokens": f'{s["tokens_in"] or 0}→{s["tokens_out"] or 0}'})
            elif s["SpanName"].startswith("execute_tool"):
                try:
                    args = json.loads(s["args"] or "{}")
                except ValueError:
                    args = {}
                city = str(args.get("location") or args.get("city") or "")
                steps.append({"kind": "tool", "tool": s["tool"], "city": city, "args": s["args"], "failed": tool_failed(s["result"]),
                              "result": s["result"][:300], "label": f'{s["tool"]}({city})'})
        agent = next((s for s in spans if s["SpanName"].startswith("invoke_agent")), None)
        reply = agent["final_result"] if agent else ""
        out.append(dict(
            id=tid[:8], trace_id=tid, session=session, turn=turn_of[tid], text=text, reply=reply, steps=steps,
            cities=cur_cities, ctx_cities=ctx_cities, intent=intent_of(text, len(cur_cities)), lang=language_of(text),
            blocked=any(s["SpanName"] == "guardrail.blocked" for s in spans),
            model=next((s["model"] for s in chats if s["model"]), ""), latency_ms=round(int(agent["Duration"] if agent else 0) / 1e6),
        ))
    return out


def signals(e: dict) -> list[str]:
    tools = [s for s in e["steps"] if s["kind"] == "tool"]
    called = {canon(s["city"]) for s in tools if s["city"]}
    sig = []
    if e["blocked"]:
        sig.append("blocked")
    if e["intent"] in WEATHER_INTENTS and e["ctx_cities"] and not tools and not e["blocked"]:
        sig.append("refused_without_tool" if re.search(REFUSAL, norm(e["reply"])) else "answered_without_tool")
    if tools and not e["ctx_cities"]:
        sig.append("tool_without_city_in_user_text")
    if any(s["city"] == "" for s in tools):
        sig.append("empty_argument")
    if any(c and c not in {canon(x) for x in e["ctx_cities"]} for c in called) and e["ctx_cities"]:
        sig.append("city_not_from_user")
    if len(e["cities"]) >= 2 and len(called & {canon(c) for c in e["cities"]}) < len(e["cities"]):
        sig.append("compare_partial")
    if any(s["failed"] for s in tools):
        sig.append("tool_result_error")
    if any(a["kind"] == "tool" and a.get("args") == b.get("args") and a.get("tool") == b.get("tool") for a, b in zip(e["steps"], e["steps"][1:]) if b["kind"] == "tool"):
        sig.append("repeated_call")
    t = norm(e["text"])
    if ("fahrenheit" in t and "°f" not in norm(e["reply"]) and " f" not in norm(e["reply"])) or ("kelvin" in t and not re.search(r"\bk\b|kelvin", norm(e["reply"]))):
        sig.append("unit_ignored")
    return sig


def build(eps: list[dict]) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for e in eps:
        e["signals"] = signals(e)
        ep = f"ep:{e['id']}"
        g.add_node(ep, type="episode", label=e["text"][:42] or e["id"], **{k: e[k] for k in ("text", "reply", "intent", "lang", "signals", "session", "turn", "model", "latency_ms", "blocked")})
        g.add_edge(ep, f"intent:{e['intent']}", rel="HAS_INTENT")
        g.add_node(f"intent:{e['intent']}", type="intent", label=e["intent"])
        for c in e["cities"]:
            g.add_node(f"city:{norm(c)}", type="city", label=c)
            g.add_edge(ep, f"city:{norm(c)}", rel="MENTIONS")
        if e["model"]:
            g.add_node(f"model:{e['model']}", type="model", label=e["model"])
            g.add_edge(ep, f"model:{e['model']}", rel="RUNS_ON")
        prev = None
        for i, s in enumerate(e["steps"]):
            sid = f"step:{e['id']}:{i}"
            g.add_node(sid, type="step_" + s["kind"], label=s["label"], **{k: v for k, v in s.items() if k not in ("kind", "label")})
            g.add_edge(ep, sid, rel="HAS_STEP", order=i)
            if prev:
                g.add_edge(prev, sid, rel="NEXT")
            prev = sid
            if s["kind"] == "tool":
                g.add_node(f"tool:{s['tool']}", type="tool", label=s["tool"])
                g.add_edge(sid, f"tool:{s['tool']}", rel="CALLS")
                if s["city"]:
                    g.add_node(f"city:{norm(s['city'])}", type="city", label=s["city"])
                    g.add_edge(sid, f"city:{norm(s['city'])}", rel="ARG_CITY")
        for sg in e["signals"]:
            g.add_node(f"signal:{sg}", type="signal", label=sg)
            g.add_edge(ep, f"signal:{sg}", rel="SIGNALS")
    return g


if __name__ == "__main__":
    eps = episodes()
    g = build(eps)
    (HERE / "out").mkdir(exist_ok=True)
    data = {
        "episodes": [{k: e[k] for k in ("id", "session", "turn", "text", "reply", "intent", "lang", "signals", "cities", "steps", "latency_ms")} for e in eps],
        "nodes": [{"id": n, **a} for n, a in g.nodes(data=True)],
        "edges": [{"from": u, "to": v, **a} for u, v, a in g.edges(data=True)],
    }
    (HERE / "out" / "graph.json").write_text(json.dumps(data, ensure_ascii=False))
    types = Counter(a["type"] for _, a in g.nodes(data=True))
    print(f"{len(eps)} episodios | {g.number_of_nodes()} nodos {dict(types)} | {g.number_of_edges()} aristas")
    print("intenciones:", dict(Counter(e["intent"] for e in eps)))
    print("señales:", dict(Counter(s for e in eps for s in e["signals"])))
