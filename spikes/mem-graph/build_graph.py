"""Construye, de forma automática y sin nada específico de un agente, el grafo de una traza a otra -> `out/graph.json`.

Nada está escrito a mano para el weather assistant: ni listas de ciudades, ni palabras clave, ni nombres.
  1. Estructura (sin LLM): episodio, pasos LLM y de herramienta, herramienta, argumentos, errores, bloqueos. Salen de los spans.
  2. Texto libre (LLM, una llamada por conversación): qué pide el usuario y qué cosas concretas nombra (entidades de cualquier tipo).
     Las peticiones se agrupan en pocas categorías con nombre (una llamada) y cada herramienta recibe un nombre corto leído de su descripción.
  3. Señales genéricas, válidas para cualquier agente con herramientas (ver SIGNALS): se calculan comparando lo que dijo el usuario
     con los argumentos de las herramientas; un LLM solo decide si dos textos nombran lo mismo («Londres» y «London»).

  GROQ_API_KEY=... python build_graph.py
"""
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx

import intents
import judge
import llm
import patterns

HERE = Path(__file__).parent
QUALITY: dict = {}  # estabilidad y silueta de las categorías de petición, se guardan en graph.json
SIGNALS = ["no_tool", "tool_error", "repeated_call", "ignored_user_entity", "invented_argument", "blocked"]  # vocabulario de MemTrace, no del agente


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", "".join(c for c in unicodedata.normalize("NFKD", str(s).lower()) if not unicodedata.combining(c))).strip()


def user_texts(input_messages: str) -> list[str]:
    try:
        msgs = json.loads(input_messages)
    except ValueError:
        return []
    return [p["content"] for m in msgs if m.get("role") == "user" for p in m.get("parts", []) if p.get("type") == "text" and p.get("content")]


def tool_failed(result: str) -> bool:
    r = result.lower()
    return not r.strip() or '"error"' in r or "'error'" in r or "not found" in r or "no se encontr" in r


def string_args(args: str) -> list[str]:
    try:
        d = json.loads(args or "{}")
    except ValueError:
        return []
    return [v for v in d.values() if isinstance(v, str) and v]


def load() -> tuple[list[dict], dict[str, str]]:
    by_trace, defs = defaultdict(list), {}
    for line in (HERE / "data" / "spans.jsonl").read_text().splitlines():
        s = json.loads(line)
        by_trace[s["TraceId"]].append(s)
        if s["tool_defs"] and not defs:
            defs = {d["name"]: d.get("description", "") for d in json.loads(s["tool_defs"])}
    seen, eps = Counter(), []
    for tid, spans in sorted(by_trace.items(), key=lambda kv: min(s["ts"] for s in kv[1])):
        spans.sort(key=lambda s: s["ts"])
        chats = [s for s in spans if s["SpanName"].startswith("chat ")]
        history = user_texts(chats[0]["input_messages"]) if chats else []
        agent = next((s for s in spans if s["SpanName"].startswith("invoke_agent")), None)
        steps = []
        for s in spans:
            if s["SpanName"].startswith("chat "):
                steps.append({"kind": "llm", "tokens": f'{s["tokens_in"] or 0}→{s["tokens_out"] or 0}'})
            elif s["SpanName"].startswith("execute_tool"):
                steps.append({"kind": "tool", "tool": s["tool"], "args": s["args"], "values": string_args(s["args"]),
                              "failed": tool_failed(s["result"]), "result": s["result"][:300]})
        session = spans[0]["ConversationId"]
        eps.append(dict(id=tid[:8], session=session, turn=seen[session], text=history[-1] if history else "", history=history[:-1],
                        reply=agent["final_result"] if agent else "", steps=steps,
                        blocked=any("blocked" in s["SpanName"] for s in spans), latency_ms=round(int(agent["Duration"] if agent else 0) / 1e6),
                        model=next((s["model"] for s in chats if s["model"]), "")))
        seen[session] += 1
    return eps, defs


def understand(eps: list[dict], defs: dict[str, str]) -> dict[str, str]:
    """Capa 2 con LLM: petición y entidades por conversación, categorías de petición y nombre corto de cada herramienta."""
    for e in eps:
        ctx = ("Previous messages: " + " | ".join(e["history"][-2:]) + "\n") if e["history"] else ""
        r = llm.ask_json(
            "You analyze one message sent to an AI assistant. Return JSON only: "
            '{"request": "...", "entities": [{"type": "...", "value": "..."}]}. '
            "'request' = what the user wants, as a short generic phrase in Spanish (max 6 words, without specific names or values). "
            "'entities' = concrete things the message names (places, dates, units, people, products...); 'value' copied exactly from the "
            "message, 'type' a short generic noun in Spanish. " + ctx + "Message: " + e["text"])
        e["request"] = str(r.get("request") or "sin petición clara").strip()
        e["entities"] = [x for x in r.get("entities", []) if isinstance(x, dict) and x.get("value")]

    for e in eps:  # plantilla: el mensaje con cada entidad sustituida por su tipo («¿Va a llover en <ciudad>?»)
        tpl = e["text"]
        for x in sorted(e["entities"], key=lambda x: -len(x["value"])):
            tpl = re.sub(re.escape(x["value"]), f"<{x['type']}>", tpl, flags=re.I)
        e["template"] = tpl
    counts = Counter(e["template"] for e in eps)
    cat_of, quality = intents.group_templates(counts)
    QUALITY.update(quality)
    for e in eps:
        e["intent"] = cat_of.get(e["template"], "Otras peticiones")

    names = {}
    for tool, desc in defs.items():
        names[tool] = str(llm.ask_json('Give a short name in Spanish (2 to 4 words, no jargon) for this assistant tool. Return JSON only: {"name": "..."}.\n'
                                       f"Tool: {tool}\nDescription: {desc}").get("name") or tool)
    return names


def resolve_entities(eps: list[dict]) -> None:
    """Une las entidades que nombran lo mismo («Londres», «London»): un LLM agrupa los valores y se queda con el más frecuente."""
    freq = Counter(x["value"] for e in eps for x in e["entities"])
    values = sorted(freq)
    canon = {v: v for v in values}
    for i in range(0, len(values), 60):
        chunk = values[i:i + 60]
        r = llm.ask_json("Group the numbered values that name exactly the same thing (same place, date, unit, person... even in another "
                         "language or spelling). Values that are different things stay out. Return JSON only: "
                         '{"groups": [[numbers of values that are the same], ...]}.\n' + "\n".join(f"{n + 1}. {v}" for n, v in enumerate(chunk)))
        for g in r.get("groups", []):
            members = [chunk[n - 1] for n in g if isinstance(n, int) and 0 < n <= len(chunk)]
            if len(members) > 1:
                best = max(members, key=lambda m: (freq[m], -len(m)))
                canon.update({m: best for m in members})
    for e in eps:
        for x in e["entities"]:
            x["canonical"] = canon[x["value"]]


def same_entity_judge(pairs: list[tuple[str, str]]) -> dict[tuple[str, str], bool]:
    """Un LLM decide si dos textos nombran lo mismo; solo se le pregunta por los que no coinciden literalmente."""
    todo = sorted({p for p in pairs if norm(p[0]) != norm(p[1]) and norm(p[0]) not in norm(p[1]) and norm(p[1]) not in norm(p[0])})
    out = {}
    for i in range(0, len(todo), 40):
        chunk = todo[i:i + 40]
        r = llm.ask_json("For each numbered pair decide whether both texts name the same thing (same place, date, unit, person... even in another "
                         "language or spelling). Return JSON only: {\"same\": [true or false for each pair, in order]}.\n"
                         + "\n".join(f"{n + 1}. {a} | {b}" for n, (a, b) in enumerate(chunk))).get("same", [])
        out.update({p: bool(r[n]) if n < len(r) else False for n, p in enumerate(chunk)})
    return out


def signals(eps: list[dict]) -> None:
    pairs = []
    for e in eps:
        vals = [v for s in e["steps"] if s["kind"] == "tool" for v in s["values"]]
        ents = [x["value"] for x in e["entities"]]
        e["_vals"], e["_ents"] = vals, ents
        pairs += [(a, b) for a in ents for b in vals] + [(b, a) for a in ents for b in vals]
    same = same_entity_judge(pairs)
    match = lambda a, b: norm(a) == norm(b) or norm(a) in norm(b) or norm(b) in norm(a) or same.get((a, b)) or same.get((b, a))

    # ¿qué tipos de entidad suelen llegar a una herramienta? solo de esos tiene sentido avisar si se ignoran
    seen, used = Counter(), Counter()
    for e in eps:
        for x in e["entities"]:
            if e["_vals"]:
                seen[x["type"]] += 1
                used[x["type"]] += any(match(x["value"], v) for v in e["_vals"])
    tool_bound = {t for t in seen if used[t] / seen[t] >= 0.3}

    for e in eps:
        tools = [s for s in e["steps"] if s["kind"] == "tool"]
        sig = []
        if e["blocked"]:
            sig.append("blocked")
        if not tools and not e["blocked"]:
            sig.append("no_tool")
        if any(s["failed"] for s in tools):
            sig.append("tool_error")
        if any(a.get("tool") == b.get("tool") and a.get("args") == b.get("args") for a, b in zip(tools, tools[1:])):
            sig.append("repeated_call")
        if tools and any(x["type"] in tool_bound and not any(match(x["value"], v) for v in e["_vals"]) for x in e["entities"]):
            sig.append("ignored_user_entity")
        context = e["_ents"] + [e["text"]] + e["history"]
        if any(not any(match(c, v) for c in context) for v in e["_vals"]):
            sig.append("invented_argument")
        e["signals"] = sig


def build(eps: list[dict], tool_names: dict[str, str], defs: dict[str, str]) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for e in eps:
        ep = f"ep:{e['id']}"
        g.add_node(ep, type="episode", label=e["text"][:42] or e["id"], verdict=e.get("verdict", ""))
        intent = f"intent:{norm(e['intent'])}"
        g.add_node(intent, type="intent", label=e["intent"])
        g.add_edge(ep, intent, rel="HAS_INTENT")
        for x in e["entities"]:
            en = f"entity:{norm(x.get('canonical', x['value']))}"
            g.add_node(en, type="entity", label=x.get("canonical", x["value"]), kind=x["type"])
            g.add_edge(ep, en, rel="MENTIONS")
        prev = None
        for i, s in enumerate(e["steps"]):
            sid = f"step:{e['id']}:{i}"
            g.add_node(sid, type="step_" + s["kind"], label=tool_names.get(s.get("tool"), "LLM"), **{k: v for k, v in s.items() if k not in ("kind", "tool", "values")})
            g.add_edge(ep, sid, rel="HAS_STEP", order=i)
            if prev:
                g.add_edge(prev, sid, rel="NEXT")
            prev = sid
            if s["kind"] == "tool":
                g.add_node(f"tool:{s['tool']}", type="tool", label=tool_names.get(s["tool"], s["tool"]), description=defs.get(s["tool"], ""))
                g.add_edge(sid, f"tool:{s['tool']}", rel="CALLS")
        for sg in e["signals"]:
            g.add_node(f"signal:{sg}", type="signal", label=sg)
            g.add_edge(ep, f"signal:{sg}", rel="SIGNALS")
    return g


if __name__ == "__main__":
    eps, defs = load()
    tool_names = understand(eps, defs)
    resolve_entities(eps)
    signals(eps)
    judged = judge.judge(eps)
    mined = patterns.mine(eps, tool_names)
    g = build(eps, tool_names, defs)
    (HERE / "out").mkdir(exist_ok=True)
    keep = ("id", "session", "turn", "text", "reply", "intent", "request", "entities", "signals", "steps", "latency_ms", "history", "verdict", "reason", "judges")
    data = {
        "quality": QUALITY, "judge": judged, "patterns": mined,
        "tools": {t: {"name": tool_names.get(t, t), "description": d} for t, d in defs.items()},
        "episodes": [{k: e[k] for k in keep} for e in eps],
        "nodes": [{"id": n, **a} for n, a in g.nodes(data=True)],
        "edges": [{"from": u, "to": v, **a} for u, v, a in g.edges(data=True)],
    }
    (HERE / "out" / "graph.json").write_text(json.dumps(data, ensure_ascii=False))
    types = Counter(a["type"] for _, a in g.nodes(data=True))
    print(f"{len(eps)} conversaciones | {g.number_of_nodes()} nodos {dict(types)} | {g.number_of_edges()} aristas")
    print("peticiones:", dict(Counter(e["intent"] for e in eps)))
    print("calidad de las categorías:", QUALITY)
    print("herramientas:", {t: tool_names[t] for t in tool_names})
    print("juez:", judged)
    print("patrones:", [(p["text"], p["fail"], p["n"], p["rate"], p["rest_rate"], p["validated"]) for p in mined["patterns"]])
    print("señales:", dict(Counter(s for e in eps for s in e["signals"])))
