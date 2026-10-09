"""Recorrido guiado del registro de prompts de MemTrace con el asistente del tiempo.

    cd weather_assistant
    uv run python scripts/prompts_demo.py

Qué hace, en orden:
  1. Crear el prompt: te da el texto exacto y espera a que exista en MemTrace con el tag `dev` (crearlo, enlazarlo al agente
     y etiquetarlo necesita una persona: la API key del agente no puede).
  2. Versionarlo: guarda una v2 como BORRADOR con la API key del agente (`prompts.save_draft`) y espera a que la publiques
     y muevas `dev` a ella en MemTrace.
  3. Usarlo: pregunta al asistente en marcha con cada versión y comprueba, por `/api/prompt`, cuál usa.
  4. Trazarlo: cada respuesta lleva su `trace_id`; vota 👍 a una y te dice dónde ver la versión en cada traza.

Necesita el asistente arrancado con las mismas variables (otra terminal):
    MEMTRACE_API_URL=<url con el id del experimento> MEMTRACE_API_KEY=<key> \\
    WEATHER_ASSISTANT_MEMTRACE_HEADERS="authorization=Bearer <key>" uv run uvicorn app.main:app
"""

import argparse
import os
import sys
import time
from pathlib import Path

import httpx
from memtrace import prompts
from memtrace.prompts import PromptNotFoundError, PromptUnavailableError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # para importar `app` desde scripts/

from app.agents.assistant import compose_instructions
from app.capabilities.registry import build_capabilities
from app.prompt_registry import prompt_name

QUESTIONS = ["¿Qué tiempo hace hoy en Sevilla?", "¿Y mañana en Madrid? ¿Necesito paraguas?"]
V2_EXTRA = "\n\nResponde siempre en una sola frase y empieza con un emoji del tiempo."
WAIT_SECONDS = 180


def step(number: int, title: str) -> None:
    print(f"\n=== {number}. {title} ===")


def fail(message: str) -> None:
    print(f"\n✗ {message}")
    sys.exit(1)


def registry_version(tag: str) -> int | None:
    """La versión a la que apunta el tag en MemTrace, o None si el prompt o el tag aún no existen."""
    try:
        return prompts.get(prompt_name(), tag=tag).version
    except (PromptNotFoundError, PromptUnavailableError):
        return None


def wait_for(description: str, probe, accept) -> object:
    print(f"  esperando: {description} (hasta {WAIT_SECONDS}s)…")
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        value = probe()
        if accept(value):
            return value
        time.sleep(3)
    fail(f"No ocurrió a tiempo: {description}")


def assistant_prompt(client: httpx.Client) -> dict:
    return client.get("/api/prompt").json()


def ask(client: httpx.Client, question: str, session_id: str | None = None) -> dict:
    response = client.post("/api/chat", json={"message": question, "session_id": session_id}, timeout=90)
    response.raise_for_status()
    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--assistant-url", default="http://localhost:8000")
    parser.add_argument("--tag", default=os.getenv("MEMTRACE_ENVIRONMENT") or os.getenv("WEATHER_ASSISTANT_PROMPT_TAG", "dev"), help="tag que sigue el asistente (su entorno)")
    args = parser.parse_args()

    if not os.getenv("MEMTRACE_API_URL") or not os.getenv("MEMTRACE_API_KEY"):
        fail("Faltan MEMTRACE_API_URL (con el id del experimento) y MEMTRACE_API_KEY en el entorno.")
    name = prompt_name()

    # ---- 1. crear
    step(1, f'Crear el prompt "{name}"')
    default_text = compose_instructions(build_capabilities(None))
    if registry_version(args.tag) is None:
        print(f'  En MemTrace: Prompts → + New prompt, nombre "{name}", asociado a este agente, con este texto:\n')
        print("  " + default_text.replace("\n", "\n  "))
        print(f'\n  Después mueve el tag "{args.tag}" a la v1.')
        wait_for(f'el prompt "{name}" con el tag "{args.tag}"', lambda: registry_version(args.tag), lambda v: v is not None)
    v1 = registry_version(args.tag)
    print(f'  ✓ "{name}" existe y "{args.tag}" apunta a la v{v1}')

    # ---- 3 (primera parte). el asistente lo usa
    with httpx.Client(base_url=args.assistant_url, timeout=10) as client:
        step(2, "El asistente usa el prompt del registro")
        try:
            state = assistant_prompt(client)
        except httpx.HTTPError:
            fail(f"No llego al asistente en {args.assistant_url}. Arráncalo (ver el principio de este fichero).")
        if state["source"] != "registry":
            fail("El asistente usa su texto por defecto: arrancó antes de existir el prompt. Reinícialo y vuelve a lanzar el script.")
        print(f'  ✓ usa "{state["name"]}" v{state["version"]} (tag {state["tag"]})')
        traces: list[tuple[int, str, str]] = []
        for question in QUESTIONS:
            answer = ask(client, question)
            traces.append((state["version"], answer["trace_id"], question))
            print(f'  v{state["version"]} · {question}\n      → {answer["reply"][:120]!r}\n      traza {answer["trace_id"]}')

        # ---- 2. versionar
        step(3, "Modificarlo: nace la v2 (borrador)")
        base = prompts.get(name, tag=args.tag).content
        draft = prompts.save_draft(
            name, base + V2_EXTRA, message="Respuestas de una frase con emoji", based_on=v1, rationale="Prueba del recorrido guiado"
        )
        print(f"  ✓ borrador v{draft.version} guardado con la API key del agente. Un borrador no lo usa ningún entorno.")
        print(f'  En MemTrace: abre "{name}", versión {draft.version} → Publish, y mueve el tag "{args.tag}" a ella.')
        wait_for(f'"{args.tag}" apuntando a la v{draft.version}', lambda: registry_version(args.tag), lambda v: v == draft.version)
        print("  El asistente lo recoge solo (consulta cada 30 s, sin reiniciar)…")
        state = wait_for(
            "el asistente sirviendo la nueva versión", lambda: assistant_prompt(client), lambda s: s["version"] == draft.version
        )
        print(f'  ✓ el asistente ya usa la v{state["version"]}')

        # ---- 4. trazas
        step(4, "Trazas con la versión nueva")
        for question in QUESTIONS:
            answer = ask(client, question)
            traces.append((state["version"], answer["trace_id"], question))
            print(f'  v{state["version"]} · {question}\n      → {answer["reply"][:120]!r}\n      traza {answer["trace_id"]}')
        voted = traces[-1]
        client.post("/api/chat/feedback", json={"trace_id": voted[1], "rating": "up", "comment": "recorrido guiado"}).raise_for_status()
        print(f"  ✓ 👍 enviado a la traza {voted[1]} (v{voted[0]})")

    print("\n=== Qué mirar en MemTrace ===")
    print(f'  • Prompts → "{name}" → pestaña Evidence: trazas, coste y feedback por versión (v{v1} vs v{state["version"]}).')
    print("  • Trazas: cada una de estas lleva el prompt y la versión que la produjo:")
    for version, trace_id, question in traces:
        print(f"      v{version}  {trace_id}  {question}")
    print(f'  • Dependencies: este agente y lo que sirve en "{args.tag}".')


if __name__ == "__main__":
    main()
