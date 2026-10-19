"""Pasos 2 a 4 del diseño: episodio por traza, resultado multi-señal y paso decisivo.

Solo lee spans, feedback y puntuaciones. No lee ground_truth.json ni el atributo `intent`
(en datos reales no existe: la intención se deduce agrupando objetivos, ver discover.py).
"""
import json
import re
from pathlib import Path

import pandas as pd

DATA = Path(__file__).parent / "data"
OUT = Path(__file__).parent / "out"

# pesos de cada señal en el resultado (el diseño los llama «resultado multi-señal»)
W_ERROR, W_LOOP, W_EVAL, W_DOWN = 1.0, 0.8, 0.7, 0.6
W_UP, W_EVAL_OK = -0.3, -0.2
FAILED, SUSPECT = 0.6, 0.3
LOOP_MIN_CHATS = 4  # una conversación normal hace 2 llamadas al modelo


def normalise(msg: str) -> str:
    msg = re.sub(r"\d+", "N", msg or "")
    return msg.strip()[:80]


def has_empty_arg(args: str) -> bool:
    """¿Alguna llamada a una herramienta lleva un argumento vacío? Vale para cualquier herramienta."""
    try:
        return any(v in ("", None) for v in json.loads(args).values())
    except (ValueError, AttributeError):
        return False


def load_jsonl(name):
    with open(DATA / name) as f:
        return [json.loads(line) for line in f]


def build():
    spans = pd.DataFrame(load_jsonl("spans.jsonl"))
    feedback = pd.DataFrame(load_jsonl("feedback.jsonl")).drop_duplicates("TraceId").set_index("TraceId")["thumbs"]
    scores = pd.DataFrame(load_jsonl("eval_scores.jsonl")).groupby("TraceId")["score"].min()

    episodes = []
    for trace_id, g in spans.groupby("TraceId", sort=False):
        g = g.sort_values("Timestamp", kind="stable")
        root = g.iloc[0]
        attrs = root["SpanAttributes"]
        steps = []
        for _, r in g.iterrows():
            if r["SpanName"] in ("conversation_turn", "invoke_agent agent"):
                continue
            tool = r["SpanAttributes"].get("tool.name", "")
            steps.append({"name": "chat" if r["SpanName"].startswith("chat ") else tool, "status": r["StatusCode"],
                          "msg": r["StatusMessage"], "exc": r["ExceptionType"],
                          "args": r["SpanAttributes"].get("tool.args", ""),
                          "result": r["SpanAttributes"].get("tool.result", ""),
                          "answer": r["SpanAttributes"].get("gen_ai.completion", "")})
        # paso decisivo: el span fallido más profundo (los padres heredan el error y se ignoran)
        failing = [s for s in steps if s["status"] == "STATUS_CODE_ERROR"]
        decisive = failing[0] if failing else None
        n_chat = sum(1 for s in steps if s["name"] == "chat")
        tool_names = [s["name"] for s in steps if s["name"] != "chat"]

        has_error = decisive is not None
        loop = n_chat >= LOOP_MIN_CHATS
        thumbs = feedback.get(trace_id)
        score = scores.get(trace_id)
        eval_fail = score is not None and score == 0

        value, reasons = 0.0, []
        if has_error:
            value += W_ERROR; reasons.append("error_span")
        if loop:
            value += W_LOOP; reasons.append("retry_loop")
        if eval_fail:
            value += W_EVAL; reasons.append("eval_failed")
        if thumbs == "down":
            value += W_DOWN; reasons.append("thumbs_down")
        if thumbs == "up":
            value += W_UP
        if score is not None and score == 1:
            value += W_EVAL_OK
        outcome = "failed" if value >= FAILED else "suspect" if value >= SUSPECT else "ok"

        episodes.append({
            "trace_id": trace_id,
            "ts": root["Timestamp"],
            "goal": attrs.get("user.message", ""),
            "lang": attrs.get("user.lang", ""),
            "model": attrs.get("gen_ai.request.model", ""),
            "prompt_version": attrs.get("prompt.version", ""),
            "tools": ">".join(tool_names),
            # insumos para los rasgos automáticos de discover.py: todos los pasos en orden, herramientas con
            # algún argumento vacío, y los atributos de la traza (sin el texto libre ni el id de usuario)
            "steps": ">".join(s["name"] for s in steps),
            "empty_arg_tools": ",".join(sorted({s["name"] for s in steps if s["name"] != "chat" and has_empty_arg(s["args"])})),
            "attrs": {k: v for k, v in attrs.items() if k not in ("user.message", "enduser.id")},
            # lo que ve una persona (o un LLM) al leer la conversación: pasos con argumentos, resultado y respuesta
            "step_log": steps,
            "answer": next((s["answer"] for s in reversed(steps) if s["answer"]), ""),
            "n_chat": n_chat,
            "n_tools": len(tool_names),
            "decisive_step": decisive["name"] if decisive else "",
            "decisive_error": normalise(decisive["msg"]) if decisive else "",
            "decisive_exc": decisive["exc"] if decisive else "",
            "decisive_args": decisive["args"] if decisive else "",
            "has_error": has_error,
            "loop": loop,
            "thumbs": thumbs or "",
            "eval_score": score if score is not None else -1,
            "value": round(value, 2),
            "outcome": outcome,
            "reasons": ",".join(reasons),
        })
    df = pd.DataFrame(episodes)
    OUT.mkdir(exist_ok=True)
    df.to_pickle(OUT / "episodes.pkl")
    return df


if __name__ == "__main__":
    df = build()
    print(len(df), "episodios")
    print(df["outcome"].value_counts().to_string())
    print(df[df.outcome != "ok"]["reasons"].value_counts().head(12).to_string())
