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
- **A local file** — `data=Path("examples.jsonl")` (one `{"input", "expected_output"?, "metadata"?}` JSON object per line) or a `.json` file holding a list of them. No MemTrace dependency. Note it must be a `pathlib.Path`: a plain string is always treated as a dataset id. The result's `dataset_version` is a content fingerprint (`sha256:...`), so two runs over an edited file are told apart.
- **Your own `DatasetSource`** — anything with a `.fetch() -> Iterable[EvalItem]` method, if you want to pull examples from your own store.
- **A dataset id string** — fetched from MemTrace's query API (needs `pip install "memtrace-ai[eval]"` and a MemTrace deployment). Create the dataset and its items either from the dashboard (**Datasets** → New dataset → Items tab), or via the API: `POST /experiments/{experimentId}/datasets` and `POST /experiments/{experimentId}/datasets/{datasetId}/items` (see the [Query API](/platform/api#evaluation-adr-028)).

  Datasets are versioned automatically: every time you publish changes from the dashboard a new version is created (if you added or deleted items it bumps the major number, if you only edited content it bumps minor) rather than mutating in place, so a run submitted yesterday always stays reproducible even if you edit the dataset today. In the dashboard's Items tab you edit directly in the table like a spreadsheet (Enter moves down, Shift+Enter adds a line break, you can paste rows copied from Excel/Sheets, and the blank last row adds items); nothing is saved until you press **Publish**, and everything you changed in that session becomes **one** version with an automatic summary (e.g. "Added 3 · Edited 2 · Removed 1"). There is no manual "create version" step, and every item records who added or last changed it, and when. `run_experiment(data=dataset_id)` fetches items from the dataset's **latest** version at the moment it runs, unless you pin one with `dataset_version="2.1"` (the same `major.minor` the dashboard shows) — the run is then recorded against that version, so you can re-run exactly what you ran before even after the dataset changed. An unknown version raises an HTTP 404 error; `dataset_version` is only valid together with a dataset id; the dashboard's Versions tab is a read-only history: one row per version with how many items were added (`+`), modified (`~`) or removed (`−`) versus the previous one. Click ⓘ on a row to see who changed what and a side-by-side diff (old on the left, new on the right, removed in red and added in green), and use **Compare with** to diff it against any earlier version, not just the previous one.

### Local vs. MemTrace, side by side

Two runnable scripts show the same toy agent fed from each source:

| | [`examples/07_dataset_source_local.py`](https://github.com/martia-es/memtrace/blob/main/examples/07_dataset_source_local.py) | [`examples/07_dataset_source_memtrace.py`](https://github.com/martia-es/memtrace/blob/main/examples/07_dataset_source_memtrace.py) |
|---|---|---|
| Data lives in | a `.jsonl` file next to your code | MemTrace (Postgres), editable from the dashboard |
| Call | `run_experiment(data=Path("toy_dataset.jsonl"), ..., sink=None)` | `run_experiment(data="<dataset_id>", dataset_version="2.0", ...)` |
| Needs | nothing (no stack, no network) | a MemTrace deployment, `memtrace-ai[eval]`, an agent API key |
| Versions | you manage them (e.g. git) | automatic; read the latest or pin an exact `major.minor` |
| Results | in memory, or your own `sink` | uploaded to the dashboard, recorded against the version used |

## Reading the results locally

`ExperimentResult` is usable without MemTrace:

```python
print(result.dataset_version)   # "2.1" (MemTrace dataset), "sha256:..." (local file), None (plain list)
print(result.error_count)       # items whose task raised
for s in result.summary():      # one entry per evaluator
    print(s.name, s.pass_rate, s.average, s.count)
```

`pass_rate` is the share of `True` for boolean evaluators, `average` the mean for numeric ones (categorical ones have neither) — the same numbers the dashboard shows for an uploaded run.

## Where the results go

By default, results upload back to MemTrace **only when `data` was a dataset id** — MemTrace never guesses a destination for data it didn't hand you. In every other case, pass your own `sink` (anything with a `.save(result)` method) or `sink=None` to keep the result only in memory:

```python
run_experiment(data=my_local_data, task=my_agent, evaluators=[...], name="v2", sink=None)
```

Uploading happens **while the experiment runs**, in batches, each item as soon as it finishes (a slow item never holds the others back): if the process dies midway, the items already computed are in MemTrace and the run shows as `running` instead of being lost. A failed batch is retried with the next one; if something is still unsent at the end, `run_experiment` raises `ResultsUploadError`, whose `.result` holds the complete result. A custom sink can opt in to the same behavior by implementing `start(name=, dataset_version=)`, `add(index, item_result)` and `finish(result)` (`IncrementalResultsSink`); a plain `.save(result)` sink is called once at the end.

Every uploaded run records **the exact dataset version it read** (the one the server actually served, even if someone edits the dataset while the experiment runs). A run whose version isn't known — e.g. local data uploaded to a MemTrace dataset — is refused rather than attributed to "latest"; pass `MemTraceResultsSink(dataset_id, version="2.1")` to state it.

When `data` is a dataset id, the run appears in the dashboard under **Runs** (and under that dataset's own Runs tab, in **Datasets**) for that experiment. Set `MEMTRACE_API_URL` to include the experiment id (e.g. `http://localhost:3001/api/v1/experiments/<experimentId>`) and `MEMTRACE_API_KEY` to an agent key created from the dashboard (Experiment → API keys) — the same key already used for tracing. See [`examples/05_eval_dataset_source_memtrace.py`](https://github.com/martia-es/memtrace/blob/main/examples/05_eval_dataset_source_memtrace.py) for a full script (and [`05_eval_dataset_source_local.py`](https://github.com/martia-es/memtrace/blob/main/examples/05_eval_dataset_source_local.py) for the no-MemTrace path).

**Metrics → Offline evals** has three views over your completed runs (runs still `running` are left out, so a partial upload never looks like a regression):

- **Trend** — pass rate (boolean) and average (numeric) per evaluator across runs, filterable by dataset and time range, with the latest run compared against the previous one. A diamond marks where an LLM judge's model or rubric changed, since those points are not directly comparable.
- **Run** — one run: its metrics, latency (p50 / p95 / max) and the items that errored or failed a boolean evaluator.
- **Compare** — pick a baseline (A) and a candidate (B): per-evaluator deltas, which items regressed or improved (items are matched by identical input), and **what changed in the dataset** between their versions (added / modified / removed items, and which regressions touch a changed item). If both runs used the same dataset version, it says so: the difference does not come from the data.

Latency is read from the traces linked to each item (`TraceId`), so it only appears for items where your agent was traced during `task`; otherwise the view says it is not recorded. Native per-item latency, tokens and retrieved RAG chunks are not stored yet.

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

Every judge score records **which judge produced it**: the model (`judge_model`) and a short fingerprint of the rubric (`judge_prompt_hash`: the system prompt plus the prompt template, not the per-item text). The run detail page shows both when you hover a score. The model comes from `Correctness(client=..., model="...")` or, if you don't pass one, from the client's `model` attribute (`AnthropicJudgeClient` has one); a custom `LLMClient` without it leaves `judge_model` empty. Change the model or edit a judge's prompt and the hash changes, so you can tell which runs are comparable. **Metrics → Offline evals** uses it to warn you: when an evaluator's judge differs from the previous run's, the affected chart points become red diamonds, an alert lists the change, and the latest-run card shows "judge changed" instead of the delta, because that difference doesn't measure your agent. Scores uploaded before this feature have no judge identity.

`AnthropicJudgeClient` is a default, optional client — write your own against the `LLMClient` protocol (`complete(*, system, prompt, model=None) -> str`) to use a different provider. See ADR-029 (`docs/adrs/evaluation/adr-029-llm-as-judge-evaluators.md` in the repository) for the design.

## Score configs: rubrics for human labels

Automatic evaluators are versioned code, so a free-text score name is fine for them. Human labels are not: two people who both type `tone` may mean a 1-5 scale and a `formal`/`casual` choice, and their values can't be compared. A **score config** fixes that by declaring, per experiment, what can be scored and how.

Each config has a `name`, a type that matches the scores you already know (`numeric` with a min/max range, `boolean`, or `categorical` with at least two labels, each optionally carrying a number for ordinal scales like `bad=0, ok=1, good=2`) and an optional guideline for whoever annotates. Admins manage them from **Admin → experiment → Score configs**; every member can read them.

Because human labels are long-lived, a rubric can never silently reinterpret old labels: the type is fixed, a numeric range can only widen, categories can only be added, and "deleting" archives the config (it stays readable, but takes no new annotations). To start over, archive it and create a new one — the old name is free to reuse.

Give a config the same `name` and type as one of your evaluators (say `correctness`) to line human and judge scores up. If the types differ, they're reported as not comparable instead of mixed. See ADR-036 (`docs/adrs/evaluation/adr-036-score-configs-annotation-rubrics.md` in the repository), and the [Query API](/platform/api) for the endpoints.

### Annotating a trace

Open any trace and press **Annotate**. Every score config of the experiment appears with its guideline and the right control (buttons for yes/no, categories and short numeric scales; a number field for wide ranges). Pick a value, add an optional comment and **Save**. You can score the whole trace or, with **Selected span**, the span highlighted in the tree (say, one wrong tool call).

- Your label is yours: saving again edits it, **Retract** removes it. Other people's labels are listed with their author, and several people can label the same trace and config.
- Experiment admins can retract anyone's label (moderation).
- **Automatic scores** from evaluation runs that reference the trace are shown below the human labels, tagged with their source (`code` / `llm_judge`), so you see machine and human judgments in one place.
- Labels are kept even if trace retention later removes the trace, and archiving a config never hides the labels already made with it. See ADR-037 (`docs/adrs/evaluation/adr-037-human-annotations-storage-and-api.md` in the repository).

### Reviewing traces with a queue

Annotating one trace you happen to be looking at doesn't scale into a review process. A **review queue** is a batch of traces for your team to work through with a rubric, so nothing is reviewed twice or forgotten. Open **Review** in the sidebar.

1. **Create a queue** (experiment admins): a name, optional instructions for reviewers, which score configs to use as the rubric (each can be required or optional) and how many independent reviews each trace needs (1–10).
2. **Add traces** (any member): **Add traces** on a queue adds the traces matching a filter *right now* (time window, status, failed spans, minimum duration, up to 500). The queue keeps their ids; it does not follow new traffic. Tick **Pick them at random** to draw the traces at random from all matches (up to the 5,000 most recent) instead of taking the first ones. From any trace, **Add to queue** adds that one trace.
3. **Review**: **Review** shows a trace next to the rubric. **Submit & next** saves your labels and brings the next one; **Skip** hands the trace back to the others. Nobody gets the same trace twice, and with several reviewers per trace each one labels it independently. Refreshing the page returns the trace you had open.
4. **Follow progress**: **Details** shows completed / pending counts, what each reviewer has done, the rubric and every item.

- Your labels are ordinary annotations (see above): they show up in the trace's **Annotate** panel with your name.
- A trace you started but never submitted goes back to the pool after 15 minutes, so a closed tab never blocks the queue.
- If a trace is gone by the time you open it (retention), press **Skip**; an admin can mark it **unreviewable** in Details so it stops being handed out.
- Changing "reviews required per item" on a running queue reopens items that no longer have enough reviews (or completes the ones that now do). A rubric can grow once the queue has items, but a score config can't be removed from it.
- Admins can archive a queue. Archived queues stay readable but no longer hand out items.

See ADR-039 (`docs/adrs/evaluation/adr-039-annotation-queues.md` in the repository), and the [Query API](/platform/api#annotation-queues-adr-039) for the endpoints.

## Can you trust the judge? Agreement with human labels

An LLM judge that says "92 % pass" is only useful if people would have agreed with it. Label a sample by hand and MemTrace measures how often they do. Open a run (**Evaluation → dataset → run**): the **Agreement with human labels** card compares each judge evaluator with the human labels of the same items.

1. **Name your human rubric like your evaluator.** Create a [score config](#score-configs-rubrics-for-human-labels) with the same name and type as the evaluator (`correctness`, boolean). Names are matched exactly; the card lists names that exist on only one side so you can see why something is missing.
2. **Send a random sample to a review queue.** **Send items to a review queue** on the run page asks for a *random sample* of N of the run's items (50 by default; you can also send them all if the run has 500 or fewer) and puts them in a queue that uses that rubric. Review them as usual (see above). The sample is drawn on the server, so it works for runs of any size, and its seed is shown in the confirmation so it can be reproduced.
3. **Read the card.** Per evaluator you get:
   - **Cohen's kappa** for yes/no and categorical scores: agreement beyond what chance would give. Around 0.6 or more is solid; below 0.4 means the judge is not tracking human opinion. It is shown next to the plain **exact agreement** because the plain number misleads on skewed data: if 95 % of items pass, a judge that always says "pass" agrees 95 % of the time and has a kappa of 0.
   - A **confusion matrix** (rows: human, columns: judge).
   - For numeric scores: mean absolute error, Spearman ρ, Pearson r and the share within ±1.
   - **Where they differ**: the items where judge and human disagree, each one a link to the row. This is the most useful part: read those items and fix the judge's prompt.

Things to keep in mind:

- **Sample size.** With fewer than 20 compared items the card still shows numbers but warns they are noise.
- **Sampling.** If reviewers only label the items the judge failed, agreement says nothing about the rest. That is why sending a random sample is the default. A queue's judge-vs-human card states how its items were chosen (randomly sampled, chosen by a filter or whole run, or picked by hand) and warns when the sample is not purely random.
- **Several reviewers on one item.** For yes/no and categories the majority label is used (items with a tie are left out and counted); for numbers, the average.
- **Kappa "–"** means it is undefined: judge and humans gave a single label to every item.
- **Mixed judges.** If one run's scores for an evaluator come from different judge versions (see above), no number is shown for it, since it would average two different instruments.
- **Queues.** A queue's details also show how much the *reviewers* agree with each other (mean kappa, or Spearman for numbers). That is the ceiling for any judge: low agreement between people usually means the rubric is ambiguous. If the queue holds run items, the same judge-vs-human card appears there too; traces in it are not compared, since only run items have judge scores.

See ADR-040 (`docs/adrs/evaluation/adr-040-judge-human-agreement.md` in the repository), and the [Query API](/platform/api#agreement-adr-040) for the endpoints.

## Install

The default MemTrace-backed adapters need the `eval` extra:

```bash
pip install "memtrace-ai[eval]"
```

Not needed if you only use local data and `sink=None`. The bundled `AnthropicJudgeClient` needs its own extra:

```bash
pip install "memtrace-ai[eval-judges]"
```
