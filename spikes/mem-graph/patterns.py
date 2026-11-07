"""Patrones que separan los fallos de los éxitos. Solo cuenta; no hay reglas del agente ni LLM.

Para cada rasgo de una conversación (tipo de petición, herramienta usada, señal) se compara la tasa de fallo con y sin
el rasgo, dentro de la misma petición cuando el rasgo es una herramienta o una señal. Se acepta si:
  1. Fisher exacto + Benjamini-Hochberg sobre la mitad de «descubrimiento» (q <= 0.1), y
  2. en la otra mitad (por sesión, nunca se mezclan conversaciones de una misma sesión) la tasa con el rasgo
     es al menos el doble que sin él.
Solo se usan conversaciones con veredicto `ok` o `bad` (las dudosas y parciales no cuentan).
"""
import zlib
from collections import defaultdict

from scipy.stats import fisher_exact

MIN_SUPPORT = 5
SIGNAL_TEXT = {  # vocabulario de MemTrace (válido para cualquier agente)
    "no_tool": "responde sin consultar ninguna herramienta", "tool_error": "una herramienta devuelve error",
    "repeated_call": "repite la misma llamada", "ignored_user_entity": "no usa algo que el cliente dijo",
    "invented_argument": "usa un dato que el cliente no dio", "blocked": "se bloquea la petición",
}


def _features(e: dict, tool_names: dict[str, str]) -> list[tuple]:
    tools = {s["tool"] for s in e["steps"] if s["kind"] == "tool"}
    return [("tool", t) for t in tools] + [("signal", s) for s in e["signals"]]


def _text(intent: str | None, kind: str, value: str, tool_names: dict[str, str]) -> str:
    what = f"usa «{tool_names.get(value, value)}»" if kind == "tool" else SIGNAL_TEXT.get(value, value)
    if kind == "intent":
        return f"Las peticiones de tipo «{value}» acaban mal"
    return f"Cuando piden «{intent}» y el asistente {what}" if intent else f"Cuando el asistente {what}"


def _table(group: list[dict], present: set[str]) -> tuple[int, int, int, int]:
    a = sum(e["fail"] for e in group if e["id"] in present)
    b = sum(not e["fail"] for e in group if e["id"] in present)
    c = sum(e["fail"] for e in group if e["id"] not in present)
    d = sum(not e["fail"] for e in group if e["id"] not in present)
    return a, b, c, d


def _bh(ps: list[float]) -> list[float]:
    order = sorted(range(len(ps)), key=ps.__getitem__)
    q, prev = [1.0] * len(ps), 1.0
    for rank, i in reversed(list(enumerate(order, 1))):
        prev = min(prev, ps[i] * len(ps) / rank)
        q[i] = prev
    return q


def mine(eps: list[dict], tool_names: dict[str, str]) -> dict:
    judged = [dict(e, fail=e["verdict"] == "bad") for e in eps if e["verdict"] in ("ok", "bad")]
    half = lambda e: zlib.crc32(e["session"].encode()) % 2  # 0: descubrimiento, 1: validación
    feats = {e["id"]: set(_features(e, tool_names)) for e in judged}
    scopes: dict[str | None, list[dict]] = {None: judged}
    for i in {e["intent"] for e in judged}:
        scopes[i] = [e for e in judged if e["intent"] == i]
    cands = []
    for intent, group in scopes.items():
        for f in {f for e in group for f in feats[e["id"]]}:
            present = {e["id"] for e in group if f in feats[e["id"]]}
            if len(present) < MIN_SUPPORT or len(present) == len(group):
                continue
            disc = [e for e in group if half(e) == 0]
            a, b, c, d = _table(disc, present)
            if a + b == 0 or c + d == 0:
                continue
            p = fisher_exact([[a, b], [c, d]], alternative="greater")[1]
            cands.append((intent, f, present, p))
    qs = _bh([c[3] for c in cands]) if cands else []
    out = []
    for (intent, (kind, value), present, p), q in zip(cands, qs):
        group = scopes[intent]
        a, b, c, d = _table(group, present)
        va, vb, vc, vd = _table([e for e in group if half(e) == 1], present)
        rate, rest = a / (a + b), (c / (c + d) if c + d else 0.0)
        holds = va + vb > 0 and va >= 2 and va / (va + vb) >= 2 * (vc / (vc + vd) if vc + vd else 0.0)
        if q <= 0.1 and rate > rest:
            out.append({"text": _text(intent, kind, value, tool_names), "intent": intent, "kind": kind, "value": value,
                        "n": a + b, "fail": a, "rate": round(rate, 2), "rest_rate": round(rest, 2), "q": round(q, 4),
                        "validated": bool(holds), "episodes": sorted(e["id"] for e in group if e["id"] in present and e["fail"])})
    out.sort(key=lambda r: (-r["validated"], -(r["rate"] - r["rest_rate"]), -r["fail"]))
    return {"judged": len(judged), "failed": sum(e["fail"] for e in judged), "patterns": out}
