# Prompts

Read your agent's prompts from the [MemTrace registry](../platform/prompts) instead of hard-coding them. Then the version of each environment is a tag you move in MemTrace (no redeploy), and every trace tells you which version produced it.

```python
from memtrace import prompts

weather = prompts.get("weather-system")        # load once: module level or your lifespan

def answer(city: str) -> str:
    system = weather.compile(city=city)         # on every request: in memory, no network
    return run_agent(system, ...)
```

Needs `pip install "memtrace-ai[eval]"`, `MEMTRACE_API_URL` (with the experiment id, like [offline evaluation](./evaluation#sending-results-to-memtrace)) and `MEMTRACE_API_KEY`. The prompt has to belong to that agent in MemTrace (creating it from the agent's **Prompts** page does it).

## `get()` returns a handle, not text

Agents usually load their prompts once at startup. A string loaded then would be frozen until the next restart, so `get()` returns a **handle** that keeps following the version:

- **`compile()` does not touch the network.** It reads the version already in memory and fills the `{{variables}}`. Measured with a live span: about 20 µs (p50) and under 0.1 ms (p99); the SDK tests keep it under 1 ms.
- **Moving a tag reaches the agent by itself.** A background thread asks MemTrace every 30 seconds (an unchanged tag costs an empty `304`), so pointing `pro` to another version in MemTrace changes what the agent uses within seconds, without restarting.
- **MemTrace being down does not stop the agent.** The last version it had keeps serving. When the agent *starts* and cannot reach MemTrace, it uses the [disk cache](#start-while-memtrace-is-down) or your `default=`.

```python
weather.version    # number of the version in use now
weather.content    # its raw text, with {{variables}}
weather.compile(city="Sevilla")
```

`compile()` raises `MissingVariableError` if the prompt uses a variable you did not pass (it lists all that are missing). Extra variables are ignored, and values are inserted as text: a value that contains `{{other}}` is not expanded again.

## Which version does it follow?

| Call | Follows |
|---|---|
| `prompts.get("weather-system")` | the tag named like `MEMTRACE_ENVIRONMENT` (`dev`, `pre`, `pro`) |
| `prompts.get("weather-system", tag="pro")` | that tag, whatever the environment |
| `prompts.get("weather-system", version=3)` | version 3 forever |

A prompt, tag or version that does not exist raises `PromptNotFoundError` **at startup**, even if you gave a `default=`: it is a mistake, not an outage. Asking for the same prompt twice returns the same handle.

## Frameworks that freeze the prompt

If you pass `compile()`'s result when you build the agent, the version is frozen in it. Give the framework a function instead, so the text is resolved on every run. `handle.as_callable(**variables)` returns one.

**Pydantic AI**: `instructions` accepts a function and evaluates it on every run (tested with the real library):

```python
agent = Agent(model, instructions=weather.as_callable(city="Sevilla"))   # built once, in the lifespan
```

**LangChain / LangGraph** (`create_agent`, LangChain 1.x): use the middleware. It replaces the agent's system message on every model call with the version in force at that moment, so the agent is built once and still follows the tag:

```python
from langchain.agents import create_agent
from memtrace.langchain import prompt_middleware

agent = create_agent(
    model,
    tools,
    middleware=[prompt_middleware(weather, city=lambda request: request.runtime.context.city, tone="friendly")],
)
```

A value that is a function (like `city` above) is called with LangChain's `ModelRequest` on every call, so a variable can come from the state or the run context; the other values are fixed. The middleware *replaces* the system message: do not also pass `system_prompt=`. It works with `invoke` and `ainvoke`. Needs `pip install "memtrace-ai[langchain-agents]"` (LangChain 1.0, Python 3.10+).

For a hand-made chain (LCEL), resolve the prompt inside it, when it runs:

```python
chain = RunnableLambda(lambda q: [SystemMessage(weather.compile(city="Sevilla")), HumanMessage(q)]) | model
```

## Evaluate a version before promoting it

If the prompt has a [promotion policy](../platform/prompts#promotion-policy-evaluate-before-you-promote), `pre` and `pro` only accept a version whose offline evaluation passed. For MemTrace to know which version an evaluation used, run it **in a process where the agent reads the prompt through `memtrace.prompts`**, calling `compile()` inside the step that `run_experiment` evaluates:

```python
weather = prompts.get("weather-system", version=7)     # the version you want to promote

def task(*, item):
    with memtrace.trace_step_context("turn", step_type="agent"):
        return run_agent(weather.compile(city=item.input["city"]), item.input["question"])

run_experiment(data="<dataset id>", task=task, evaluators=[...], name="v7 before promoting")
```

Pinning `version=` guarantees every item of the run used that version. A run that mixes versions does not count for any of them.

## Try a version in the real agent

MemTrace's **Try it** tab runs a version of the prompt in *your running agent* —with its tools and knowledge— for one message, without moving any tag. For that, the non-production agent has to accept the request:

1. Read the prompt with `memtrace.prompts` (as above).
2. Set `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true` (off by default; do not set it in production).
3. Install the middleware, so the token MemTrace sends reaches your prompts:

```python
from memtrace.prompts import PromptOverrideMiddleware

app = FastAPI(...)
app.add_middleware(PromptOverrideMiddleware)        # any ASGI app: FastAPI, Starlette, Quart…
```

Without ASGI (Flask, Django, a queue worker), wrap the handling of the request yourself:

```python
with prompts.override(request.headers.get("x-memtrace-prompt-override")):
    answer = run_agent(...)
```

How it works: MemTrace calls your agent's chat endpoint with a token that lives two minutes. When your code calls `compile()`, the SDK presents the token to MemTrace (with your API key) and uses the version it grants **for that request only**; the next request goes back to the tag. A token MemTrace does not recognize, one for another agent or prompt, or MemTrace being unreachable, all serve the normal version: a test can never break a request. Spans of the test carry `memtrace.playground=true` and do not count as [evidence](../platform/prompts#evidence-what-each-version-did) or toward the promotion gate.

## Link traces to the prompt version

Every `compile()` writes `memtrace.prompt.name` and `memtrace.prompt.version` on the **current span**, so call it inside the step that uses the prompt (a `trace_step`, or inside an auto-instrumented run). In MemTrace you can then filter the traces and spans of one version (`promptName` / `promptVersion` in the [Query API](../platform/api)). Outside any span nothing is written and nothing fails. The `default=` text has no version, so it is never written.

## The dashboard shows what really runs

The SDK tells MemTrace which version each prompt of the agent is using (every 5 minutes, and right after a tag moves), together with `MEMTRACE_ENVIRONMENT`. The prompt page shows, per environment, **the version that is running** and whether it has caught up with its tag. Set `MEMTRACE_ENVIRONMENT` to the environment key (`dev`, `pre`, `pro`) so it is reported in the right place.

## Start while MemTrace is down

Set `MEMTRACE_PROMPT_CACHE_DIR` to a directory and the SDK keeps the last version it served of every prompt there. If the agent restarts while MemTrace is unreachable, it starts from that file. Without a cache, `default=` is used:

```python
weather = prompts.get("weather-system", default="You are a weather assistant for {{city}}.")
```

The handle leaves the default as soon as MemTrace answers (it retries every few seconds). Without a cache and without a default, `get()` raises `PromptUnavailableError`. The default also lets you run locally with no `MEMTRACE_API_URL` at all.

## In async code

`get()` waits for MemTrace (3 seconds at most). In a FastAPI `lifespan`, use the async version so the event loop is not blocked:

```python
weather = await prompts.aget("weather-system")
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MEMTRACE_ENVIRONMENT` | none | Environment of this agent; the default tag followed and where its usage is reported |
| `MEMTRACE_PROMPT_REFRESH_SECONDS` | `30` | How often a followed tag is checked |
| `MEMTRACE_PROMPT_USAGE_SECONDS` | `300` | How often the version in use is reported |
| `MEMTRACE_PROMPT_TIMEOUT_SECONDS` | `3` | Timeout of each call to MemTrace |
| `MEMTRACE_PROMPT_CACHE_DIR` | none | Directory for the last known versions |

The prompts keep working with `MEMTRACE_ENABLED=false`: that only turns tracing off.
