"""Episodio por traza: pasos ordenados, paso decisivo y resultado multi-señal (Fase 2.0, Observar).

Lógica pura, sin ClickHouse ni red: recibe las filas de una traza y devuelve una fila de `mem_episodes`.
Portada del spike `spikes/mem/episodes.py`, ya contra el esquema real de `otel_traces`
(`gen_ai.operation.name`, `gen_ai.tool.*`, `StatusCode`) en lugar de los datos sintéticos.

El resultado NO es una etiqueta de verdad: es una estimación a partir de varias señales débiles. Por eso guarda
`reasons` (qué señales sumaron) y `EPISODE_VERSION`: si se cambian pesos o umbrales se sube la versión y el worker
recalcula los episodios.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

# Versión de las reglas de abajo: cámbiala si tocas pesos, umbrales o la definición de bucle.
EPISODE_VERSION = 2  # 2: añade Attributes y EmptyArgTools (migración 019)

# Peso de cada señal en el valor del episodio. Las positivas empujan hacia «fallo», las negativas hacia «bien».
W_ERROR, W_LOOP, W_EVAL, W_DOWN = 1.0, 0.8, 0.7, 0.6
W_UP, W_EVAL_OK = -0.3, -0.2
FAILED, SUSPECT = 0.6, 0.3  # umbrales: valor >= FAILED → «failed»; >= SUSPECT → «suspect»
LOOP_MIN_REPEATS = 3  # la misma llamada (o el mismo error del modelo) tres veces seguidas es un bucle

# Atributos de la traza que se guardan para que el descubrimiento pueda cruzar fallos con el contexto (idioma, canal...).
# Solo valores cortos y sin pinta de identificar a nadie: es una lista de exclusión, así que se revisa si aparecen claves nuevas.
ATTR_VALUE_MAX = 64
ATTR_KEY_DENY_PREFIXES = ("gen_ai.", "memtrace.input", "memtrace.output", "memtrace.metadata", "enduser.", "http.", "url.")
ATTR_KEY_DENY_PARTS = ("id", "email", "phone", "name", "token", "key", "secret", "password", "address", "ip", "message")
GOAL_MAX = 500
ERROR_MAX = 120
STATUS_ERROR = "STATUS_CODE_ERROR"


@dataclass(frozen=True)
class SpanRow:
    """Lo que el worker necesita de un span de `otel_traces`."""

    span_id: str
    parent_span_id: str
    timestamp: datetime
    name: str
    operation: str  # gen_ai.operation.name: chat | execute_tool | invoke_agent | ...
    tool_name: str
    tool_args: str
    tool_result: str
    status_code: str
    status_message: str
    exception_type: str
    input_messages: str
    output_messages: str
    attributes: dict[str, str] = field(default_factory=dict)  # atributos de la traza; solo se rellena en el span raíz


@dataclass(frozen=True)
class TraceSignals:
    """Señales externas a los spans: feedback del usuario final y puntuaciones de evaluadores."""

    thumbs_up: int = 0
    thumbs_down: int = 0
    eval_scores: tuple[float, ...] = ()


@dataclass
class Episode:
    trace_id: str
    service_name: str
    experiment_id: str
    conversation_id: str
    started_at: datetime
    revision: str
    prompt_name: str
    prompt_version: int
    model: str
    goal: str
    answer: str
    steps: list[str] = field(default_factory=list)
    n_chat: int = 0
    n_tools: int = 0
    decisive_span_id: str = ""
    decisive_step: str = ""
    decisive_error: str = ""
    decisive_exception: str = ""
    has_error: bool = False
    loop: bool = False
    thumbs: int = 0  # 1 = 👍, -1 = 👎, 0 = sin voto o contradictorio
    eval_score: float | None = None
    value: float = 0.0
    outcome: str = "ok"
    reasons: list[str] = field(default_factory=list)
    attributes: dict[str, str] = field(default_factory=dict)
    empty_arg_tools: list[str] = field(default_factory=list)


def safe_attributes(attrs: dict[str, str]) -> dict[str, str]:
    """Atributos de la traza aptos para guardar: valores cortos y claves que no parecen identificadores ni contenido."""
    keep = {}
    for key, value in attrs.items():
        parts = set(re.split(r"[._\-]", key.lower()))
        if key.startswith(ATTR_KEY_DENY_PREFIXES) or parts & set(ATTR_KEY_DENY_PARTS):
            continue
        if value and len(value) <= ATTR_VALUE_MAX and "@" not in value:
            keep[key] = value
    return keep


def has_empty_argument(args: str) -> bool:
    """¿Esta llamada a una herramienta lleva algún argumento vacío? Vale para cualquier herramienta."""
    try:
        parsed = json.loads(args)
    except (ValueError, TypeError):
        return False
    return isinstance(parsed, dict) and any(v in ("", None) for v in parsed.values())


def normalise_error(msg: str) -> str:
    """Quita los números (ids, tiempos, códigos de cuota) para que el mismo error agrupe igual."""
    return re.sub(r"\d+", "N", msg or "").strip()[:ERROR_MAX]


def _message_text(msg: object) -> str:
    """Texto de un mensaje en formato GenAI: `content` plano o una lista de `parts` con `content`/`text`."""
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    parts = msg.get("parts", content)
    if isinstance(parts, list):
        texts = [p.get("content") or p.get("text") or "" for p in parts if isinstance(p, dict)]
        return " ".join(t for t in texts if isinstance(t, str) and t)
    return ""


def messages_text(raw: str, role: str) -> str:
    """Texto del último mensaje con ese rol dentro de `gen_ai.input/output.messages` (JSON). Tolera texto plano."""
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except ValueError:
        return raw.strip()
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return ""
    for msg in reversed(data):
        if isinstance(msg, dict) and msg.get("role") == role:
            text = _message_text(msg).strip()
            if text:
                return text
    return ""


def _is_step(span: SpanRow) -> bool:
    return span.operation in ("chat", "execute_tool")


def _step_name(span: SpanRow) -> str:
    return "chat" if span.operation == "chat" else (span.tool_name or span.name)


def decisive_span(spans: list[SpanRow]) -> SpanRow | None:
    """El span fallido más profundo: los padres heredan el error de sus hijos y no son la causa.

    Si hay varios independientes (reintentos), se queda con el primero en el tiempo: es el que desencadena el resto.
    """
    failing = [s for s in spans if s.status_code == STATUS_ERROR]
    if not failing:
        return None
    parents_of_failing = {s.parent_span_id for s in failing}
    leaves = [s for s in failing if s.span_id not in parents_of_failing]
    return min(leaves or failing, key=lambda s: s.timestamp)


def has_loop(steps: list[SpanRow]) -> bool:
    """Bucle: la misma llamada a una herramienta, o el mismo error del modelo, repetidos LOOP_MIN_REPEATS veces."""
    keys = Counter()
    for s in steps:
        if s.operation == "execute_tool":
            keys[("tool", _step_name(s), s.tool_args)] += 1
        elif s.status_code == STATUS_ERROR:
            keys[("chat_error", normalise_error(s.status_message))] += 1
    return any(n >= LOOP_MIN_REPEATS for n in keys.values())


def _eval_signal(scores: tuple[float, ...]) -> tuple[float | None, bool, bool]:
    """(puntuación mínima, ¿falló?, ¿pasó?). Convención: 0 = falla, 1 = pasa (booleanos y 0-1)."""
    if not scores:
        return None, False, False
    low = min(scores)
    return low, low == 0, low == 1


def score_outcome(*, has_error: bool, loop: bool, thumbs: int, eval_failed: bool, eval_ok: bool) -> tuple[float, str, list[str]]:
    value, reasons = 0.0, []
    if has_error:
        value += W_ERROR
        reasons.append("error_span")
    if loop:
        value += W_LOOP
        reasons.append("retry_loop")
    if eval_failed:
        value += W_EVAL
        reasons.append("eval_failed")
    if thumbs < 0:
        value += W_DOWN
        reasons.append("thumbs_down")
    if thumbs > 0:
        value += W_UP
    if eval_ok:
        value += W_EVAL_OK
    outcome = "failed" if value >= FAILED else "suspect" if value >= SUSPECT else "ok"
    return round(value, 2), outcome, reasons


def build_episode(trace_id: str, service_name: str, experiment_id: str, spans: list[SpanRow], signals: TraceSignals, *,
                  conversation_id: str = "", revision: str = "", prompt_name: str = "", prompt_version: int = 0,
                  model: str = "") -> Episode | None:
    """Devuelve el episodio de una traza, o None si no tiene ningún paso (ni modelo ni herramienta)."""
    spans = sorted(spans, key=lambda s: s.timestamp)
    steps = [s for s in spans if _is_step(s)]
    if not steps:
        return None

    chats = [s for s in steps if s.operation == "chat"]
    goal = next((t for t in (messages_text(s.input_messages, "user") for s in chats) if t), "")
    answer = next((t for t in (messages_text(s.output_messages, "assistant") for s in reversed(chats)) if t), "")

    decisive = decisive_span(spans)
    thumbs = 1 if signals.thumbs_up and not signals.thumbs_down else -1 if signals.thumbs_down and not signals.thumbs_up else 0
    eval_score, eval_failed, eval_ok = _eval_signal(signals.eval_scores)
    has_error, loop = decisive is not None, has_loop(steps)
    value, outcome, reasons = score_outcome(has_error=has_error, loop=loop, thumbs=thumbs, eval_failed=eval_failed, eval_ok=eval_ok)
    if signals.thumbs_down and signals.thumbs_up:
        reasons.append("thumbs_mixed")

    return Episode(
        trace_id=trace_id, service_name=service_name, experiment_id=experiment_id, conversation_id=conversation_id, started_at=spans[0].timestamp,
        revision=revision, prompt_name=prompt_name, prompt_version=prompt_version, model=model,
        goal=goal[:GOAL_MAX], answer=answer[:GOAL_MAX], steps=[_step_name(s) for s in steps],
        n_chat=len(chats), n_tools=len(steps) - len(chats),
        decisive_span_id=decisive.span_id if decisive else "",
        decisive_step=(_step_name(decisive) if decisive and _is_step(decisive) else decisive.name) if decisive else "",
        decisive_error=normalise_error(decisive.status_message) if decisive else "",
        decisive_exception=decisive.exception_type if decisive else "",
        has_error=has_error, loop=loop, thumbs=thumbs, eval_score=eval_score,
        value=value, outcome=outcome, reasons=reasons,
        attributes=safe_attributes(next((s.attributes for s in spans if s.attributes), {})),
        empty_arg_tools=sorted({_step_name(s) for s in steps if s.operation == "execute_tool" and has_empty_argument(s.tool_args)}),
    )
