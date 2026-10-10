# Integrations

## LangChain / LangGraph

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

To use a [registry prompt](./prompts) as the system prompt of a `create_agent` agent (LangChain 1.x), add the middleware. It resolves the prompt on every model call, so the agent follows its tag without being rebuilt:

```python
from memtrace.langchain import prompt_middleware

agent = create_agent(model, tools, middleware=[prompt_middleware(weather, city="Sevilla")])
```

Requires `pip install "memtrace-ai[langchain]"` (Python 3.10+). See [Prompts](./prompts#frameworks-that-freeze-the-prompt) for variables that depend on the run and for other frameworks.

## Pydantic AI

```python
from memtrace import init_tracer
from memtrace.pydantic_ai import enable_pydantic_ai_instrumentation

init_tracer(service_name="my-agent")
enable_pydantic_ai_instrumentation()
```

Requires `pip install "memtrace-ai[pydantic-ai]"` (or `pydantic-ai`). Spans go to the tracer configured by `init_tracer`; no other code changes. Wrap the runs in `with session("conversation-id"):` to group them in one [conversation](./conversations). Its agent, LLM and tool spans are labeled with the same step types as your own steps.

The `enable_*` functions raise `ImportError` when their extra is missing; every other MemTrace call never raises.

## Mixing with your own steps

Spans from integrations nest under an enclosing `@trace_step` or `session(...)`, so you can trace the outer agent by hand and let the framework fill in the inside.
