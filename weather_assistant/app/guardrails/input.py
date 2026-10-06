"""Guardarraíl de entrada: decide si un mensaje llega al agente (ADR-026, ADR-047).

Son comprobaciones deterministas, sin LLM, y cada una es su propio span (`guardrail.*`) bajo
`input_guardrail`. Los spans no guardan el mensaje (se abren con `trace_step_context`, no con
`@trace_step`, que con `MEMTRACE_CAPTURE_CONTENT=true` registraría los argumentos): el mensaje puede
traer datos personales, que es justo lo que el guardarraíl evita que lleguen al modelo y a las trazas.

Cuando una comprobación bloquea, además se abre un span vacío `guardrail.blocked` con el atributo
`guardrail.check`: en Métricas, "contar spans de tipo `guardrail.blocked` agrupados por
`guardrail.check`" da cuántas veces bloqueó cada una (ADR-027).
"""

import re
from dataclasses import dataclass

from memtrace import trace_step_context

MAX_MESSAGE_CHARS = 1000

# Un asistente del tiempo no necesita datos personales: si llegan, no pasan al modelo ni a las trazas.
PII_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),  # email
    re.compile(r"\b(?:\d[ -]?){13,16}\b"),  # tarjeta
    re.compile(r"\b(?:\+?\d{1,3}[ .-]?)?(?:\d[ .-]?){9}\b"),  # teléfono
    re.compile(r"\b[XYZ]?\d{7,8}[- ]?[A-Z]\b", re.IGNORECASE),  # DNI / NIE
]

# Intentos de cambiar las instrucciones del agente o de que las revele (español e inglés).
INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"ignor(a|e|ar)\b.{0,30}\b(instrucciones|reglas|indicaciones|instructions|rules|prompt)",
        r"(olvida|forget)\b.{0,30}\b(todo|instrucciones|everything|instructions|rules)",
        r"(system|developer) prompt|prompt (del|de) (sistema|desarrollador)",
        r"(revela|muestra|repite|reveal|show|repeat|print)\b.{0,30}\b(tus|your|the)\b.{0,15}\b(instrucciones|instructions|prompt)",
        r"\b(ahora eres|a partir de ahora eres|you are now|act as|actúa como|pretend to be|finge ser)\b",
        r"\b(jailbreak|DAN mode|modo desarrollador|developer mode)\b",
    )
]

REPLIES = {
    "length": "Tu mensaje es demasiado largo; resúmelo en una pregunta sobre el tiempo. / Your message is too long; please shorten it to a weather question.",
    "pii": "No proceso datos personales (correos, teléfonos, tarjetas o documentos). Pregúntame por el tiempo sin ellos. / I don't process personal data. Ask me about the weather without it.",
    "prompt_injection": "No puedo atender esa petición. Puedo ayudarte con el tiempo de una localidad. / I can't help with that request. I can help with the weather of a place.",
}


@dataclass(frozen=True)
class GuardrailResult:
    blocked: bool
    check: str | None = None

    @property
    def reply(self) -> str | None:
        return REPLIES[self.check] if self.check else None


def check_length(message: str) -> bool:
    return len(message) > MAX_MESSAGE_CHARS


def check_pii(message: str) -> bool:
    return any(pattern.search(message) for pattern in PII_PATTERNS)


def check_prompt_injection(message: str) -> bool:
    return any(pattern.search(message) for pattern in INJECTION_PATTERNS)


# Orden: del más barato al más caro; la primera que bloquea corta, y las siguientes no se ejecutan.
CHECKS = [("length", check_length), ("pii", check_pii), ("prompt_injection", check_prompt_injection)]


def run_input_guardrail(message: str) -> GuardrailResult:
    """Pasa las comprobaciones por orden. Llámala dentro del span del turno, junto a la llamada al agente."""
    with trace_step_context("input_guardrail", step_type="chain"):
        for name, check in CHECKS:
            with trace_step_context(f"guardrail.{name}", step_type=f"guardrail.{name}"):
                blocked = check(message)
            if blocked:
                with trace_step_context("guardrail.blocked", step_type="guardrail.blocked", attributes={"guardrail.check": name}):
                    pass
                return GuardrailResult(blocked=True, check=name)
    return GuardrailResult(blocked=False)
