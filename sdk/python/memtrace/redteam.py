"""Red team your agent offline: run attacks against it and measure how many succeed (see ADR-103).

Runs in your own process like any `memtrace.eval` experiment; MemTrace never calls your agent.

    from memtrace import redteam
    from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient

    def my_agent(*, item):
        return call_my_agent(item.input)          # text, or {"text": ..., "tool_calls": [...]}

    result = redteam.run_redteam(task=my_agent, name="v2", judge_client=AnthropicJudgeClient())
    print(redteam.attack_success_rate(result))    # per category: items, attacks_succeeded, asr

With `MEMTRACE_API_URL` set the run is uploaded (as `redteam/v2`) and shows up in the dashboard's Security page.
The seed set is a starting point: add your own attacks with `extra_items=`.
"""
from typing import Any, Iterable, Mapping, Optional, Sequence

from memtrace.application.eval_ports import Evaluator, LLMClient, TaskFunction
from memtrace.application.redteam.attacks import CATEGORIES, seed_attacks
from memtrace.application.redteam.judges import (
    AttackCategory,
    AttackResisted,
    NoPiiLeak,
    NoSecretLeak,
    NoUnauthorizedTool,
    text_of,
)
from memtrace.application.redteam.runner import RUN_PREFIX, attack_success_rate, default_evaluators
from memtrace.config import settings
from memtrace.eval import run_experiment
from memtrace.domain.security import PolicyRules

__all__ = [
    "run_redteam",
    "seed_attacks",
    "publish_seed_dataset",
    "attack_success_rate",
    "default_evaluators",
    "AttackResisted",
    "AttackCategory",
    "NoSecretLeak",
    "NoPiiLeak",
    "NoUnauthorizedTool",
    "CATEGORIES",
    "text_of",
]


def publish_seed_dataset(
    *,
    name: str = "Red team seed",
    categories: Optional[Iterable[str]] = None,
    extra_items: Optional[Sequence[Mapping[str, Any]]] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> str:
    """Creates a MemTrace dataset with the seed attacks (plus `extra_items`) and returns its id. Needs the `eval` extra."""
    from memtrace.adapters.outbound.http.eval_api_client import _client

    items = [
        {"input": i["input"], "expectedOutput": i.get("expected_output"), "metadata": i.get("metadata")}
        for i in [*seed_attacks(categories), *(extra_items or [])]
    ]
    with _client(base_url, api_key) as client:
        created = client.post("/datasets", json={"name": name})
        created.raise_for_status()
        dataset_id = created.json()["id"]
        client.post(f"/datasets/{dataset_id}/items", json={"items": items}).raise_for_status()
    return dataset_id


def run_redteam(
    *,
    task: TaskFunction,
    name: str,
    categories: Optional[Iterable[str]] = None,
    extra_items: Optional[Sequence[Mapping[str, Any]]] = None,
    evaluators: Optional[Sequence[Evaluator]] = None,
    judge_client: Optional[LLMClient] = None,
    tool_policy: Optional[PolicyRules] = None,
    dataset_id: Optional[str] = None,
    upload: Optional[bool] = None,
    **run_kwargs: Any,
):
    """Runs the attacks against `task` and returns the usual `ExperimentResult`.

    `evaluators` replaces the defaults (`default_evaluators`: category, secret and PII leak checks, plus the
    LLM judge when `judge_client` is given and the tool check when `tool_policy` is). `upload` defaults to
    True when a MemTrace API URL is configured: the seed attacks are published as a dataset (or pass
    `dataset_id` to reuse one) and the run is stored as `redteam/<name>`. `run_kwargs` go to `run_experiment`.
    """
    chosen = list(evaluators) if evaluators is not None else default_evaluators(judge_client=judge_client, tool_policy=tool_policy)
    should_upload = upload if upload is not None else bool(dataset_id or settings.api_url)
    base = {k: run_kwargs.get(k) for k in ("base_url", "api_key")}
    if should_upload:
        dataset_id = dataset_id or publish_seed_dataset(categories=categories, extra_items=extra_items, **base)
        data: Any = dataset_id
    else:
        data = [*seed_attacks(categories), *(extra_items or [])]
        run_kwargs.setdefault("sink", None)
    return run_experiment(data=data, task=task, evaluators=chosen, name=f"{RUN_PREFIX}{name}", **run_kwargs)
