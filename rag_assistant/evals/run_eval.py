"""Evalúa el asistente de FAQs contra `evals/dataset.jsonl`.

El LLM es el real (`RAG_ASSISTANT_MODEL`, necesita `GOOGLE_API_KEY`); la recuperación es la del asistente (embeddings, o BM25 con `RAG_ASSISTANT_RETRIEVER=bm25`, sobre
las FAQs de ejemplo), determinista, así que una caída de la métrica significa que cambió el agente o el prompt, no los datos.

    cd rag_assistant
    uv run python evals/run_eval.py                  # evaluadores de código + recuperación
    uv run python evals/run_eval.py --judge          # + LLM-as-judge contra la respuesta ideal
    uv run python evals/run_eval.py --mock           # sin LLM: responde lo esperado (prueba del gate de despliegue)
    uv run python evals/run_eval.py --min-pass-rate 0.9

Guardado en MemTrace (trazas + dataset + run con sus scores) cuando están definidas:

    RAG_ASSISTANT_MEMTRACE_HEADERS=authorization=Bearer mtk_...
    RAG_ASSISTANT_SERVICE_NAME=<service name del experimento>
    MEMTRACE_API_URL=http://localhost:3001/api/v1/experiments/<experimentId>
    MEMTRACE_API_KEY=mtk_...        # la misma key

Sin ellas (o con `--local`) todo queda en memoria. Sin `--dataset-id` se crea un dataset nuevo con el contenido de
`dataset.jsonl`; pasa el id impreso para repetir sobre el mismo.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import memtrace
from memtrace.eval import MRR, EvalItem, HitRate, RecallAtK, run_experiment
from memtrace.eval_judges import Correctness
from pydantic_ai import Agent

from app.agents.assistant import build_assistant
from app.agents.deps import AssistantDeps
from app.capabilities.faq import search_faqs
from app.capabilities.registry import ALL_CAPABILITIES
from app.config import Settings
from app.knowledge.retriever import build_retriever, load_entries
from app.tracing import setup_tracing
from evaluators import response_checks

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


class _MockContext:
    def __init__(self, deps: AssistantDeps) -> None:
        self.deps = deps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", default="rag-assistant", help="nombre del experimento")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--judge", action="store_true", help="añade Correctness (LLM-as-judge)")
    parser.add_argument("--dataset-id", help="dataset de MemTrace sobre el que ejecutar (por defecto se crea uno)")
    parser.add_argument("--mock", action="store_true", help="sin LLM: la tarea busca en las FAQs y devuelve la respuesta esperada, así que todo pasa (prueba del gate de despliegue)")
    parser.add_argument("--local", action="store_true", help="no subir nada a MemTrace; usa dataset.jsonl y deja el resultado en memoria")
    parser.add_argument("--min-pass-rate", type=float, default=None, help="sale con código 1 si algún evaluador booleano queda por debajo")
    args = parser.parse_args()

    settings = Settings.from_env()
    traced = setup_tracing()
    deps = AssistantDeps(retriever=build_retriever(settings, load_entries(settings.knowledge_path)))
    agent = None if args.mock else build_assistant(settings.model, settings.company, ALL_CAPABILITIES)

    def task(*, item: EvalItem) -> str:
        if args.mock:  # el "agente perfecto": busca como lo haría la tool y responde lo esperado
            asyncio.run(search_faqs(_MockContext(deps), item.input))
            return str(item.expected_output)
        return asyncio.run(agent.run(item.input, deps=deps)).output

    # la recuperación se mide sobre los fragmentos que devolvió `search_faqs` (span `retriever`) frente a `metadata.relevant_docs`
    evaluators = [response_checks, RecallAtK(3), MRR(), HitRate()]
    if args.judge and not args.mock:
        evaluators.append(Correctness(client=PydanticAIJudgeClient(settings.model)))

    api_url, api_key = os.getenv("MEMTRACE_API_URL"), os.getenv("MEMTRACE_API_KEY")
    upload = not args.local and bool(api_url and api_key)
    if not args.local and not upload:
        print("MEMTRACE_API_URL / MEMTRACE_API_KEY sin definir: los resultados no se subirán (usa --local para silenciar esto).")
    data: str | Path = DATASET
    if upload:
        data = args.dataset_id or create_memtrace_dataset(api_url, api_key, args.name)
        print(f"dataset MemTrace: {data}")

    result = run_experiment(data=data, task=task, evaluators=evaluators, name=args.name, max_workers=args.workers)
    if traced:
        memtrace.flush()
    else:
        print("Trazas desactivadas: falta RAG_ASSISTANT_MEMTRACE_HEADERS.")

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
