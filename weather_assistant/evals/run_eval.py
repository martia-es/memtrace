"""Evalúa el asistente del tiempo contra `evals/dataset.jsonl`.

El LLM es el real (`WEATHER_ASSISTANT_MODEL`, necesita `GOOGLE_API_KEY`); el tiempo es el de
`FakeWeatherService`, con datos fijos, así que las cifras esperadas del dataset son estables.

    cd weather_assistant
    uv run python evals/run_eval.py                  # solo evaluadores de código
    uv run python evals/run_eval.py --judge          # + LLM-as-judge contra la respuesta ideal
    uv run python evals/run_eval.py --name v2 --workers 2

Guardado en MemTrace (trazas + dataset + run con sus scores) cuando están definidas:

    WEATHER_ASSISTANT_MEMTRACE_HEADERS=authorization=Bearer mtk_...
    WEATHER_ASSISTANT_SERVICE_NAME=<service name del experimento>
    MEMTRACE_API_URL=http://localhost:3001/api/v1/experiments/<experimentId>
    MEMTRACE_API_KEY=mtk_...        # la misma key

Sin ellas (o con `--local`) todo queda en memoria. Sin `--dataset-id` se crea un dataset nuevo
con el contenido de `dataset.jsonl`; pasa el id impreso para repetir sobre el mismo.
"""

import argparse
import asyncio
import json
import sys
import os
import threading
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pydantic_ai import Agent
from pydantic_ai.messages import ToolCallPart

import memtrace
from memtrace.eval import EvalItem, run_experiment
from memtrace.eval_judges import Correctness

from app.agents.assistant import build_assistant
from app.agents.deps import AssistantDeps
from app.capabilities.registry import ALL_CAPABILITIES
from app.config import Settings
from app.tracing import setup_tracing
from evaluators import ToolCalls, response_checks
from fakes import FakeWeatherService

DATASET = Path(__file__).resolve().parent / "dataset.jsonl"


def create_memtrace_dataset(api_url: str, api_key: str, name: str) -> str:
    """Sube `dataset.jsonl` a MemTrace (la API HTTP usa camelCase: `expectedOutput`)."""
    items = []
    for line in DATASET.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            items.append({"input": row["input"], "expectedOutput": row["expected_output"], "metadata": row["metadata"]})
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(base_url=api_url.rstrip("/"), headers=headers, timeout=30.0) as client:
        created = client.post("/datasets", json={"name": name})
        created.raise_for_status()
        dataset_id = created.json()["id"]
        client.post(f"/datasets/{dataset_id}/items", json={"items": items}).raise_for_status()
    return dataset_id


class PydanticAIJudgeClient:
    """`LLMClient` del juez sobre el mismo proveedor que el asistente (sin otra API key)."""

    def __init__(self, model: str) -> None:
        self.model = model

    def complete(self, *, system: str, prompt: str, model: str | None = None) -> str:
        agent = Agent(model or self.model, instructions=system)
        return agent.run_sync(prompt).output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", default="weather-assistant", help="nombre del experimento")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--judge", action="store_true", help="añade Correctness (LLM-as-judge)")
    parser.add_argument("--dataset-id", help="dataset de MemTrace sobre el que ejecutar (por defecto se crea uno)")
    parser.add_argument("--local", action="store_true", help="no subir nada a MemTrace; usa dataset.jsonl y deja el resultado en memoria")
    parser.add_argument("--min-pass-rate", type=float, default=None, help="sale con código 1 si algún evaluador booleano queda por debajo")
    args = parser.parse_args()

    settings = Settings.from_env()
    traced = setup_tracing()
    agent = build_assistant(settings.model, ALL_CAPABILITIES)
    weather = FakeWeatherService()

    tool_calls: dict[str, list[dict]] = {}
    lock = threading.Lock()

    def task(*, item: EvalItem) -> str:
        result = asyncio.run(agent.run(item.input, deps=AssistantDeps(weather=weather)))
        calls = [
            part.args_as_dict()
            for message in result.all_messages()
            for part in message.parts
            if isinstance(part, ToolCallPart) and part.tool_name == "get_weather"
        ]
        with lock:
            tool_calls[item.input] = calls
        return result.output

    evaluators = [ToolCalls(tool_calls), response_checks]
    if args.judge:
        evaluators.append(Correctness(client=PydanticAIJudgeClient(settings.model)))

    api_url, api_key = os.getenv("MEMTRACE_API_URL"), os.getenv("MEMTRACE_API_KEY")
    upload = not args.local and bool(api_url and api_key)
    if not args.local and not upload:
        print("MEMTRACE_API_URL / MEMTRACE_API_KEY sin definir: los resultados no se subirán (usa --local para silenciar esto).")
    data: str | Path = DATASET
    if upload:
        data = args.dataset_id or create_memtrace_dataset(api_url, api_key, args.name)
        print(f"dataset MemTrace: {data}")

    result = run_experiment(
        data=data,
        task=task,
        evaluators=evaluators,
        name=args.name,
        max_workers=args.workers,
    )
    if traced:
        memtrace.flush()
    else:
        print("Trazas desactivadas: falta WEATHER_ASSISTANT_MEMTRACE_HEADERS.")

    failures = 0
    for row in result.items:
        if row.error:
            failures += 1
            print(f"ERROR  {row.item.input!r}: {row.error}")
            continue
        failed = [s for s in row.scores if s.data_type == "boolean" and s.value is False]
        if failed:
            failures += 1
            details = "; ".join(f"{s.name}: {s.comment}" for s in failed)
            print(f"FAIL   [{row.item.metadata['category']}] {row.item.input!r}\n         -> {row.output!r}\n         {details}")

    print(f"\ndataset {result.dataset_version}  items {len(result.items)}  con fallos {failures}  errores {result.error_count}")
    below = False
    for s in result.summary():
        value = s.pass_rate if s.pass_rate is not None else s.average
        print(f"  {s.name:<16} {value:.2f}  (n={s.count})" if value is not None else f"  {s.name:<16} -  (n={s.count})")
        if args.min_pass_rate is not None and s.pass_rate is not None and s.pass_rate < args.min_pass_rate:
            below = True
    return 1 if below else 0


if __name__ == "__main__":
    sys.exit(main())
