# Offline evaluation

Run your agent against a dataset of examples and score its output, to compare two versions before deploying or to catch a regression. The `memtrace.eval` module runs entirely in your own process (a script, a notebook, a CI job). It works without a MemTrace deployment; the platform is needed only if you want to read datasets from it or upload results to it.

::: tip Online evaluation is not covered here
This page is about running an experiment on demand against a dataset you control. Continuously sampling and scoring live production traffic is a separate, not-yet-available feature.
:::

## Install

```bash
pip install "memtrace-ai[eval]"   # MemTrace dataset source, results sink and bundled AnthropicJudgeClient
```

Not needed if you only use local data and `sink=None` and pass your own `LLMClient`.

## Quick start

```python
from memtrace.eval import run_experiment, exact_match

def my_agent(*, item):
    return call_my_agent(item.input)

result = run_experiment(
    data=[{"input": "2+2?", "expected_output": "4"}],
    task=my_agent,
    evaluators=[exact_match],
    name="smoke-test",
    sink=None,  # keep the result in memory
)

for item_result in result.items:
    print(item_result.output, [(s.name, s.value) for s in item_result.scores])
```

For each item in `data`, `run_experiment` calls `task`, then runs every evaluator in `evaluators` on `(input, output, expected_output)`, and returns an `ExperimentResult` with one row per item.

## Writing an evaluator

An evaluator is any callable with `name` set, taking keyword-only arguments:

```python
from memtrace.eval import Score

class ExactMatch:
    name = "exact_match"

    def __call__(self, *, output, expected_output):
        return Score(name=self.name, value=output == expected_output, data_type="boolean")
```

Declare only the arguments you need: `input`, `output`, `expected_output` and `trace_id` are all available, but `run_experiment` passes only the ones your `__call__` declares (or all of them if it takes `**kwargs`). Return one `Score`, or a list of `Score`s if one evaluator computes several metrics.

Two built-ins are included to get started: `memtrace.eval.exact_match` and `memtrace.eval.contains`.

## Where the data comes from

`data` accepts:

- **A list you already have**: `[{"input": ..., "expected_output": ...}, ...]`, or a list of `EvalItem`.
- **A local file**: `data=Path("examples.jsonl")`, one `{"input", "expected_output"?, "metadata"?}` JSON object per line, or a `.json` file holding a list of them. It must be a `pathlib.Path`: a plain string is always treated as a dataset id. The result's `dataset_version` is a content fingerprint (`sha256:...`), so two runs over an edited file are told apart.
- **Your own `DatasetSource`**: anything with a `.fetch() -> Iterable[EvalItem]` method, if you want to pull examples from your own store.
- **A dataset id string**: fetched from the MemTrace query API. Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` and `MEMTRACE_API_KEY` (see [Where the results go](#send-them-to-memtrace-dataset-id)). Datasets are created and edited in the platform.

### Dataset versions

Datasets in MemTrace are versioned, and each version is identified by `major.minor`. A version is created when the dataset changes, so a run recorded yesterday stays reproducible even if the dataset is edited today.

`run_experiment(data=dataset_id)` reads the **latest** version at the moment it runs. To re-run exactly what you ran before, pin a version:

```python
run_experiment(data="<dataset_id>", dataset_version="2.1", task=my_agent, evaluators=[exact_match])
```

`dataset_version` is only valid together with a dataset id. An unknown version raises an HTTP 404 error. The run is recorded against the version the server actually served, even if someone edits the dataset while the experiment runs.

| | Local file | MemTrace dataset |
|---|---|---|
| Data lives in | a `.jsonl` / `.json` file next to your code | MemTrace, edited from the platform |
| Needs | nothing (no stack, no network) | a deployment, `memtrace-ai[eval]`, an agent API key |
| Versions | you manage them (e.g. git); the result carries a content fingerprint | assigned by MemTrace; read the latest or pin a `major.minor` |
| Results | in memory, or your own `sink` | uploaded to MemTrace, recorded against the version used |

### Example: a local file, end to end

```python
import json
from pathlib import Path

from memtrace.eval import contains, exact_match, run_experiment

dataset = Path("toy_dataset.jsonl")
dataset.write_text("\n".join(json.dumps(row) for row in [
    {"input": "2+2?", "expected_output": "4"},
    {"input": "capital of France?", "expected_output": "Paris"},
    {"input": "capital of Spain?", "expected_output": "Madrid"},
]))

def toy_agent(*, item):
    # Deliberately imperfect: gets Spain wrong.
    answers = {"2+2?": "4", "capital of France?": "Paris", "capital of Spain?": "Barcelona"}
    return answers.get(item.input, "I don't know")

result = run_experiment(
    data=dataset,  # a pathlib.Path -> local file (a plain str would be a dataset id)
    task=toy_agent,
    evaluators=[exact_match, contains],
    name="toy-agent-local",
    sink=None,  # keep the result in memory; nothing is uploaded
)

for r in result.items:
    print(f"{r.item.input!r:25} -> {r.output!r:12}", [(s.name, s.value) for s in r.scores])
print(result.dataset_version, [(s.name, s.pass_rate) for s in result.summary()])
```

It prints one line per item and, at the end, the file's fingerprint (`sha256:...`) with a pass rate of 0.67 for both evaluators.

## Where the results go

The destination depends on where the data came from:

| `data` is | Results go to | What you write |
|---|---|---|
| A dataset id (`"<dataset_id>"`) | MemTrace, to that dataset's runs | nothing: it is the default |
| Local data (list, `Path`, `DatasetSource`) | nowhere, until you choose | `sink=...` |

`sink=None` always means "keep it in memory only". All recipes below are runnable.

### Send them to MemTrace (dataset id)

Set the connection once. The API key is the same agent key used for tracing:

```bash
pip install "memtrace-ai[eval]"
export MEMTRACE_API_URL=http://localhost:3001/api/v1/experiments/<experimentId>
export MEMTRACE_API_KEY=mtk_...
```

| Variable | Value |
|---|---|
| `MEMTRACE_API_URL` | Includes the experiment id, e.g. `http://localhost:3001/api/v1/experiments/<experimentId>` |
| `MEMTRACE_API_KEY` | An agent API key created in the platform |

Create a dataset in the platform (or with the API), note its id and pass it as `data`. There is no `sink=` because uploading is the default for this case:

```python
from memtrace.eval import exact_match, run_experiment

def toy_agent(*, item):
    return {"2+2?": "4", "capital of France?": "Paris"}.get(item.input, "I don't know")

latest = run_experiment(data="<dataset_id>", task=toy_agent, evaluators=[exact_match], name="toy-latest")
pinned = run_experiment(data="<dataset_id>", dataset_version="2.0", task=toy_agent, evaluators=[exact_match], name="toy-v2.0")

print(latest.dataset_version, pinned.dataset_version)  # the versions actually served
```

Both runs appear in the dashboard under **Datasets > your dataset > Runs**, each with the version it used.

Items are uploaded **while the experiment runs**, in batches, each as soon as it finishes, so a slow item never holds the others back. If the process dies midway, the items already computed are kept in MemTrace and the run stays incomplete. A failed batch is retried with the next one. If something is still unsent at the end, `run_experiment` raises `ResultsUploadError`, whose `.result` holds the complete result.

### Upload local data to a MemTrace dataset

With local data there is no default destination, and a run must say which dataset version it belongs to: otherwise it is refused instead of being attributed to "latest". Build the sink yourself and state the version:

```python
from pathlib import Path
from memtrace.adapters.outbound.http.eval_api_client import MemTraceResultsSink

run_experiment(
    data=Path("toy_dataset.jsonl"),
    task=my_agent,
    evaluators=[exact_match],
    name="v2-local-data",
    sink=MemTraceResultsSink("<dataset_id>", version="2.1"),  # reads MEMTRACE_API_URL / MEMTRACE_API_KEY
)
```

You can pass `base_url=` and `api_key=` to `MemTraceResultsSink` (and to `run_experiment` in the dataset-id case) instead of using environment variables.

### Keep it in memory
Nothing leaves your process:


```python
result = run_experiment(data=data, task=my_agent, evaluators=[exact_match], name="v1", sink=None)
```

### Write a JSON file

A plain sink is any object with `.save(result)`; it is called once, at the end:


```python
import json
from pathlib import Path

class JsonFileSink:
    def __init__(self, path):
        self.path = Path(path)

    def save(self, result):
        rows = [
            {
                "input": r.item.input,
                "output": r.output,
                "error": r.error,
                "scores": {s.name: s.value for s in r.scores},
            }
            for r in result.items
        ]
        self.path.write_text(json.dumps({"name": result.name, "dataset_version": result.dataset_version, "items": rows}, indent=2))

run_experiment(data=data, task=my_agent, evaluators=[exact_match], name="v1", sink=JsonFileSink("results.json"))
```

### Stream to a JSONL file

An `IncrementalResultsSink` (`start`, `add`, `finish`) receives each item as it finishes, like MemTrace's own sink. Items arrive in completion order, so each line carries its dataset `index`; a crash keeps everything written so far:

```python
import json

class JsonlStreamSink:
    def __init__(self, path):
        self.path = path

    def start(self, *, name, dataset_version):
        self.file = open(self.path, "w")

    def add(self, index, item_result):
        row = {"index": index, "input": item_result.item.input, "output": item_result.output,
               "scores": {s.name: s.value for s in item_result.scores}}
        self.file.write(json.dumps(row) + "\n")
        self.file.flush()

    def finish(self, result):
        self.file.close()

run_experiment(data=data, task=my_agent, evaluators=[exact_match], name="v1", sink=JsonlStreamSink("results.jsonl"))
```

## Reading the results locally

`ExperimentResult` is usable without MemTrace:

```python
print(result.dataset_version)   # "2.1" (MemTrace dataset), "sha256:..." (local file), None (plain list)
print(result.error_count)       # items whose task raised
for s in result.summary():      # one entry per evaluator
    print(s.name, s.pass_rate, s.average, s.count)
```

`pass_rate` is the share of `True` for boolean evaluators, and `average` the mean for numeric ones. Categorical evaluators have neither.

## Latency, tokens and cost

Call `memtrace.init_tracer()` before `run_experiment`. Every item then runs inside its own trace (an `eval.item` span), and the trace id is saved with the result. The platform reads latency, tokens and cost from that trace. Cost needs a model with a known price.

`run_experiment` never initialises the tracer for you. Without a tracer, these figures are simply absent.

## Retrieval metrics (recall@k, MRR)

Label which documents a good retrieval must return, in the item's metadata, and add the evaluators:

```python
from memtrace.eval import run_experiment, RecallAtK, MRR, HitRate

data = [{"input": "refund policy?", "metadata": {"relevant_docs": ["policy-12", "kb/refunds.md"]}}]
run_experiment(data=data, task=my_rag_agent, evaluators=[RecallAtK(5), MRR(), HitRate()], name="rag-v3")
```

A retrieved chunk counts as relevant when its `id` or `source` is in `relevant_docs`:

- `RecallAtK(k)`: the share of the relevant documents found in the top *k* (`recall_at_5`).
- `MRR()`: the reciprocal rank of the first relevant chunk (`mrr`).
- `HitRate()`: whether at least one relevant chunk was retrieved.

Items without `relevant_docs` get no score instead of a misleading zero.

The chunks are read from your retriever calls while the item runs: LangChain retrievers do this automatically, and otherwise call `memtrace.record_retrieved_chunks(documents)` inside a `retriever` step. They are recorded on the span as `memtrace.retriever.chunks`, in rank order, with `text`, and `id` / `source` / `score` when known. The text is exported only when [content capture](./configuration#privacy-and-content-capture) is on. The metrics work with or without it.

## LLM-as-judge evaluators

`exact_match` and `contains` only work when the expected output matches the actual output as a string. For open-ended agent output, `memtrace.eval_judges` ships evaluators that ask an LLM to judge the result instead:

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

Both are plain `Evaluator`s (`Score(source="llm_judge")`), so they go in `evaluators=[...]` alongside `exact_match` and `contains`. Each item makes a real LLM call, parallelized the same way `max_workers` parallelizes `task`, so judged runs cost money and take longer.

### Which judge produced a score

Every judge score records the model (`judge_model`) and a short fingerprint of the rubric (`judge_prompt_hash`: the system prompt plus the prompt template, not the per-item text). The model comes from `Correctness(client=..., model="...")` or, if you don't pass one, from the client's `model` attribute. A custom `LLMClient` without it leaves `judge_model` empty.

If the client returns `memtrace.eval_judges.LLMReply(text, model=...)` instead of a plain string, the model it reports is what gets recorded. A provider-side change of model then shows up as a judge change too.

Changing the model or editing a judge's prompt changes the hash, so you can tell which runs are comparable.

`AnthropicJudgeClient` is a default, optional client. To use another provider, write your own against the `LLMClient` protocol: `complete(*, system, prompt, model=None) -> str`.

