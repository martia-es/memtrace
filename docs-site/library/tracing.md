# Tracing steps

## `init_tracer`

```python
init_tracer(
    service_name=None,      # service.name; defaults to MEMTRACE_SERVICE_NAME
    endpoint=None,          # OTLP endpoint
    protocol=None,          # "grpc" (default) or "http/protobuf"
    headers=None,           # e.g. {"authorization": "Bearer mtk_..."}
    span_ttl_seconds=None,  # closes orphaned spans
)
```

Idempotent and never raises. Every argument falls back to a `MEMTRACE_*` [environment variable](./configuration). With `MEMTRACE_ENABLED=false` the whole SDK is a no-op.

## `@trace_step`

```python
@trace_step(name="lookup", step_type="tool")
def lookup(key: str) -> str: ...
```

Works on functions and methods, sync or `async`. `name` defaults to the function name. Spans created inside the function, including those from LangChain or auto-instrumented libraries, become children of the step.

`step_type` is one of:

| Value | Meaning |
|---|---|
| `llm` | Model call |
| `tool` | Tool execution |
| `agent` | Agent invocation |
| `retriever` | Retrieval step |
| `embedding` | Embeddings call |
| `chain` | Anything else (default) |

The dashboard uses the type to color and filter spans.

## `trace_step_context`

The same thing for a block instead of a function:

```python
from memtrace import trace_step_context

with trace_step_context("rank_results", step_type="chain") as run_id:
    ...
```

## `trace_llm_call`

Records standardized GenAI attributes on the **current** span. Call it inside a step.

```python
trace_llm_call(
    "openai", "gpt-4o",          # provider and model; everything else is keyword-only
    operation="chat",
    input_messages=[...], output_messages=[...],
    input_tokens=180, output_tokens=52,
    response_model=None, response_id=None, finish_reasons=(),
    temperature=None, max_tokens=None, top_p=None,
    frequency_penalty=None, presence_penalty=None,
    attributes=None,   # extra span attributes
)
```

Every tracing entry point (`trace_step`, `trace_step_context`, `trace_llm_call`) also takes `service=`, the object returned by `init_tracer()`, when you need a tracer other than the global one.

Token counts feed the dashboard's token metrics. Messages are stored only when [content capture](./configuration#privacy-and-content-capture) is on.
