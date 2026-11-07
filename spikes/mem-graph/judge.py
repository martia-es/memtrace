"""Juez de resultado: ¿el asistente dio al cliente lo que pidió? Sin etiquetas humanas y sin reglas del agente.

Un LLM lee la petición, lo que hizo el asistente y su respuesta, y dice `ok`, `parcial` o `mal` con un motivo.
Se pregunta a dos modelos distintos: solo se usa el veredicto cuando coinciden (si no, `dudosa`). Una persona valida
una muestra pequeña con `validate.py` para saber cuánto fiarse.
"""
import json

import llm

SECOND_MODEL = "openai/gpt-oss-120b"
VERDICTS = {"ok", "partial", "bad"}


def _transcript(e: dict) -> str:
    steps = []
    for s in e["steps"]:
        if s["kind"] == "tool":
            steps.append(f"tool {s['tool']}({s['args'][:200]}) -> {s['result'][:200]}")
    hist = ("Earlier messages: " + " | ".join(e["history"][-2:]) + "\n") if e["history"] else ""
    return (f"{hist}User message: {e['text']}\nAssistant actions: {'; '.join(steps) or 'none (no tool used)'}\n"
            f"Assistant reply: {e['reply'][:600]}")


def _ask(e: dict, model: str) -> dict:
    r = llm.ask_json(
        "You judge whether an AI assistant gave the user what they asked for. Check the details: requested units, "
        "places, dates, and whether the answer is based on a tool result or was made up. A polite refusal of something "
        "out of scope is ok. Return JSON only: {\"verdict\": \"ok\" | \"partial\" | \"bad\", \"reason\": \"one short "
        "sentence in Spanish\"}.\n\n" + _transcript(e), model=model)
    v = str(r.get("verdict", "")).lower()
    return {"verdict": v if v in VERDICTS else "", "reason": str(r.get("reason", "")).strip()}


def judge(eps: list[dict], models: tuple[str, str] = (llm.MODEL, SECOND_MODEL)) -> dict:
    """Pone `verdict` (`ok`, `partial`, `bad` o `unsure`), `reason` y `judges` en cada episodio; devuelve un resumen."""
    for e in eps:
        a, b = (_ask(e, m) for m in models)
        e["judges"] = [a["verdict"], b["verdict"]]
        e["verdict"] = a["verdict"] if a["verdict"] and a["verdict"] == b["verdict"] else "unsure"
        e["reason"] = a["reason"] if a["verdict"] == e["verdict"] or not b["reason"] else b["reason"]
    agree = sum(e["verdict"] != "unsure" for e in eps)
    counts = {v: sum(e["verdict"] == v for e in eps) for v in sorted(VERDICTS | {"unsure"})}
    return {"models": list(models), "agreement": round(agree / max(len(eps), 1), 2), "counts": counts}


if __name__ == "__main__":
    import build_graph
    eps, _ = build_graph.load()
    print(json.dumps(judge(eps), indent=1))
