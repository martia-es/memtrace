# Offline evaluation

Run your agent against a dataset of examples and score its output — to compare two versions before deploying, or to catch a regression. This runs entirely in your own process (a script, a notebook, a CI job): MemTrace does not host or schedule this, nothing here requires a MemTrace deployment.

::: tip Online evaluation is not covered here
This page is about running an experiment on demand against a dataset you control. Continuously sampling and scoring live production traffic is a separate, not-yet-available feature.
:::

## The idea

```python
from memtrace.eval import run_experiment, exact_match

def my_agent(*, item):
    return call_my_agent(item.input)

result = run_experiment(
    data=[{"input": "2+2?", "expected_output": "4"}],
    task=my_agent,
    evaluators=[exact_match],
    name="smoke-test",
    sink=None,  # keep the result in memory; never touches MemTrace
)

for item_result in result.items:
    print(item_result.output, [(s.name, s.value) for s in item_result.scores])
```

For each item in `data`, `run_experiment` calls `task`, then runs every evaluator in `evaluators` on `(input, output, expected_output)`, and returns an `ExperimentResult` with one row per item. Nothing about `data`, `task` or `evaluators` requires MemTrace — this is a standalone evaluation harness you can use with data you already have.

## Writing an evaluator

An evaluator is any callable with `name` set, taking keyword-only arguments:

```python
from memtrace.eval import Score

class ExactMatch:
    name = "exact_match"

    def __call__(self, *, output, expected_output):
        return Score(name=self.name, value=output == expected_output, data_type="boolean")
```

Declare only the arguments you need — `input`, `output`, `expected_output`, `trace_id` are all available, but `run_experiment` passes only the ones your `__call__` declares (or all of them if it takes `**kwargs`). Return one `Score`, or a list of `Score`s if one evaluator computes several metrics.

Two built-ins are included to get started: `memtrace.eval.exact_match` and `memtrace.eval.contains`.

## Where the data comes from

`data` accepts, with no priority given to any of them:

- **A list you already have** — `[{"input": ..., "expected_output": ...}, ...]`, or a list of `EvalItem`. No MemTrace dependency.
- **Your own `DatasetSource`** — anything with a `.fetch() -> Iterable[EvalItem]` method, if you want to pull examples from your own store.
- **A dataset id string** — fetched from MemTrace's query API (needs `pip install "memtrace-ai[eval]"` and a MemTrace deployment). Create the dataset first with `POST /experiments/{experimentId}/datasets` and its items with `POST /experiments/{experimentId}/datasets/{datasetId}/items` (see the [Query API](/platform/api#evaluation-adr-028)) — the dashboard has no "create dataset" screen yet.

## Where the results go

By default, results upload back to MemTrace **only when `data` was a dataset id** — MemTrace never guesses a destination for data it didn't hand you. In every other case, pass your own `sink` (anything with a `.save(result)` method) or `sink=None` to keep the result only in memory:

```python
run_experiment(data=my_local_data, task=my_agent, evaluators=[...], name="v2", sink=None)
```

When `data` is a dataset id, the run appears in the dashboard under **Evaluation** for that experiment. Set `MEMTRACE_API_URL` to include the experiment id (e.g. `http://localhost:3001/api/v1/experiments/<experimentId>`) and `MEMTRACE_API_KEY` to an agent key created from the dashboard (Experiment → API keys) — the same key already used for tracing. See [`examples/06_evaluate_against_memtrace.py`](https://github.com/martia-es/memtrace/blob/main/examples/06_evaluate_against_memtrace.py) for a full script.

## LLM-as-judge evaluators

`exact_match`/`contains` only work when the expected output matches the actual output as a string. For open-ended agent output, `memtrace.eval_judges` ships evaluators that ask an LLM to judge the result instead:

```python
from memtrace.eval import run_experiment
from memtrace.eval_judges import Correctness
from memtrace.adapters.outbound.llm.anthropic_client import AnthropicJudgeClient

correctness = Correctness(client=AnthropicJudgeClient())

result = run_experiment(
    data=[{"input": "capital of France?", "expected_output": "Paris"}],
    task=my_agent,
    evaluators=[correctness],
    name="v2",
)
```

- **`Correctness`**: is `output` semantically equivalent to `expected_output`, regardless of wording (unlike `exact_match`).
- **`Faithfulness`**: is every claim in `output` grounded in a source context, with no invented facts. Needs `metadata={"context": "..."}` on the item:
  ```python
  {"input": "When was it founded?", "expected_output": None, "metadata": {"context": "Founded in 1999."}}
  ```

Both are plain `Evaluator`s (`Score(source="llm_judge")`), so they drop into `evaluators=[...]` alongside `exact_match`/`contains`, and the dashboard shows their verdicts the same way. Expect judged runs to cost money and take longer — each item makes a real LLM call, parallelized the same way `run_experiment`'s `max_workers` already parallelizes `task`.

`AnthropicJudgeClient` is a default, optional client — write your own against the `LLMClient` protocol (`complete(*, system, prompt, model=None) -> str`) to use a different provider. See ADR-029 (`docs/adrs/adr-029-llm-as-judge-evaluators.md` in the repository) for the design.

## Install

The default MemTrace-backed adapters need the `eval` extra:

```bash
pip install "memtrace-ai[eval]"
```

Not needed if you only use local data and `sink=None`. The bundled `AnthropicJudgeClient` needs its own extra:

```bash
pip install "memtrace-ai[eval-judges]"
```
