"""Formato común de episodio para los datasets públicos del banco de pruebas de Mem.

Una fila por traza. Cada fuente tiene su conversor y el original no se toca (vive en data/raw/, fuera de git).
"""
import json
from pathlib import Path

HERE = Path(__file__).parent.parent
RAW = HERE / "data" / "raw"
OUT = HERE / "out" / "datasets"

COLUMNS = [
    "source",         # exgentic | whowhen | mast
    "trace_id",
    "split_group",    # unidad que no puede repartirse entre descubrimiento y validación
    "outcome",        # success | fail
    "cause_infra",    # id del catálogo ADR-066 (quota_exceeded, ...) o None
    "cause_behavior", # etiqueta de la fuente, sin normalizar aún (la taxonomía está abierta: Q10)
    "cause_text",     # explicación libre de la fuente, si la hay
    "decisive_step",  # índice del paso, si la fuente lo da
    "label_origin",   # human | llm_judge | task_outcome | none
    "meta",           # dict con lo propio de la fuente (benchmark, modelo, tokens...)
    "steps",          # lista de {i, actor, text, error_type}
]


def clip(text: str, n: int = 1500) -> str:
    return text if len(text) <= n else text[:n] + f"…[+{len(text) - n}]"


def parts_text(raw: str | None, last_only: bool = False) -> str:
    """Texto de mensajes OTel GenAI (`[{role, parts: [{type, content|name|arguments}]}]`); `last_only` = solo el último."""
    if not raw or raw == "None":
        return ""
    try:
        msgs = json.loads(raw)
    except ValueError:
        return clip(str(raw))
    msgs = msgs if isinstance(msgs, list) else [msgs]
    out = []
    for m in msgs[-1:] if last_only else msgs:
        for p in m.get("parts", []):
            t = p.get("type")
            if t == "text":
                out.append(str(p.get("content", "")))
            elif t == "tool_call":
                out.append(f"[tool_call {p.get('name')}({json.dumps(p.get('arguments'), ensure_ascii=False)})]")
            elif t == "tool_call_response":
                out.append(f"[tool_result {p.get('result', p.get('response', p.get('content', '')))}]")
            else:
                out.append(f"[{t}]")
    return " ".join(out)
