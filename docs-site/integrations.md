# Integrations

## LangChain / LangGraph

Two options. Pick one.

**Manual (recommended)**: attach the callback handler per call.

```python
from memtrace import init_tracer, MemTraceCallbackHandler

init_tracer(service_name="my-agent")
chain.invoke(x, config={"callbacks": [MemTraceCallbackHandler()]})
```

Requires `pip install "memtrace-ai[langchain]"`.

**Automatic**: instrument LangChain globally.

```python
from memtrace import init_tracer, enable_langchain_instrumentation

init_tracer(service_name="my-agent")
enable_langchain_instrumentation()
chain.invoke(x)   # captured automatically
```

Requires `pip install "memtrace-ai[otel-langchain]"`.

## Pydantic AI

```python
from memtrace import init_tracer, enable_pydantic_ai_instrumentation

init_tracer(service_name="my-agent")
enable_pydantic_ai_instrumentation()
```

Uses the tracer provider configured by `init_tracer`; no other code changes.

## Mixing with your own steps

Spans from integrations nest under an enclosing `@trace_step` or `session(...)`, so you can trace the outer agent by hand and let the framework fill in the inside.
