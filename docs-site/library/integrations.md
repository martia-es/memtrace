# Integrations

## LangChain / LangGraph

### Tracing

Two options. Pick one.

**Manual (recommended)**: attach the callback handler per call.

```python
from memtrace import init_tracer
from memtrace.langchain import MemTraceCallbackHandler

init_tracer(service_name="my-agent")
chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})
```

Requires `pip install "memtrace-ai[langchain]"`.

**Automatic**: instrument LangChain once, after `init_tracer`.

```python
from memtrace import init_tracer
from memtrace.langchain import enable_langchain_instrumentation

init_tracer(service_name="my-agent")
enable_langchain_instrumentation()
chain.invoke(x)   # captured automatically
```

Requires `pip install "memtrace-ai[langchain]"`. It is safe to call again after `shutdown()` and `init_tracer()` (notebooks, tests). Do not combine it with `MemTraceCallbackHandler`: every run would be traced twice. Prompts and completions are recorded only with [content capture](./configuration#privacy-and-content-capture) on.

### Prompts from the registry

Tracing and prompts are independent: the callback handler or `enable_langchain_instrumentation()` records what runs; the middleware below decides which [registry prompt](./prompts) the agent runs with. Use them together to see, in each trace, which version produced it.

Load the prompt once (module level or your lifespan) and give the agent the middleware. It replaces the system message on **every model call** with the version in force at that moment, so the agent is built once and still follows its tag:

```python
from langchain.agents import create_agent
from memtrace import prompts
from memtrace.langchain import prompt_middleware

weather = prompts.get("weather-system")     # follows the tag of MEMTRACE_ENVIRONMENT

agent = create_agent(
    model,
    tools,
    middleware=[prompt_middleware(weather, city=lambda request: request.runtime.context.city, tone="friendly")],
)
```

- **Variables.** Each keyword argument fills a `{{variable}}` of the prompt. A plain value is fixed; a function is called with LangChain's `ModelRequest` on every call, so it can read the state or the run context. A missing variable raises `MissingVariableError`.
- **Do not also pass `system_prompt=`**: the middleware replaces the system message.
- **Sync and async.** It works with `invoke` and `ainvoke`.
- **Traces.** The prompt name and version are written on the current span, so the traces of one version can be filtered in MemTrace.
- **Version.** Pin one with `prompts.get("weather-system", version=3)` or a tag with `tag="pro"`; see [which version it follows](./prompts#which-version-does-it-follow).

Requires `pip install "memtrace-ai[langchain]"` (LangChain 1.x, Python 3.10+).

For a hand-made chain (LCEL) there is no middleware: resolve the prompt inside the chain, when it runs, never when you build it:

```python
chain = RunnableLambda(lambda q: [SystemMessage(weather.compile(city="Sevilla")), HumanMessage(q)]) | model
```

## Pydantic AI

### Tracing

```python
from memtrace import init_tracer
from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation

init_tracer(service_name="my-agent")
enable_pydantic_ai_instrumentation()
```

Requires `pip install "memtrace-ai[pydantic-ai]"` (or `pydantic-ai`). Spans go to the tracer configured by `init_tracer`; no other code changes. Wrap the runs in `with session("conversation-id"):` to group them in one [conversation](./conversations). Its agent, LLM and tool spans are labeled with the same step types as your own steps.

### Prompts from the registry

Pydantic AI has no MemTrace-specific helper: `instructions` accepts a function and evaluates it on every run, and the prompt handle gives you one. Build the agent once and it follows its tag:

```python
from pydantic_ai import Agent
from memtrace import prompts

weather = prompts.get("weather-system")

agent = Agent(model, instructions=weather.as_callable(city="Sevilla"))   # built once, in the lifespan
```

`as_callable(**variables)` returns a function that calls `compile()` each time, so the values are fixed. When a variable depends on the run (the user, the language, a dependency), write the function yourself and call `compile()` inside it:

```python
agent = Agent(model, deps_type=Deps)

@agent.instructions
def system(ctx: RunContext[Deps]) -> str:
    return weather.compile(city=ctx.deps.city)
```

- **Do not pass `weather.compile(...)` as `instructions=`** when building the agent: that freezes the version at that moment.
- `compile()` is in memory (no network), so it adds no latency to the run, and it writes the prompt name and version on the current span: the traces of the run show which version produced them.
- A missing variable raises `MissingVariableError`. Pin a version or tag with `prompts.get(..., version=3)` / `tag="pro"`.

Requires `pip install "memtrace-ai[pydantic-ai,eval]"`. See [Prompts](./prompts) for [evaluating a version before promoting it](./prompts#evaluate-a-version-before-promoting-it), trying it in the real agent, and starting while MemTrace is down.

The `enable_*` functions raise `ImportError` when their extra is missing; every other MemTrace call never raises.

## Mixing with your own steps

Spans from integrations nest under an enclosing `@trace_step` or `session(...)`, so you can trace the outer agent by hand and let the framework fill in the inside.
