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

**LangChain**: resolve the prompt inside the chain, when it runs:

```python
chain = RunnableLambda(lambda q: [SystemMessage(weather.compile(city="Sevilla")), HumanMessage(q)]) | model
```

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
