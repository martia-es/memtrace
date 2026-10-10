# Tracing steps

## `init_tracer`

```python
init_tracer(
    service_name=None,      # service.name; defaults to MEMTRACE_SERVICE_NAME
    endpoint=None,          # OTLP endpoint
    protocol=None,          # "http/protobuf" (default) or "grpc" (needs memtrace-ai[grpc])
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

Inside a `retriever` step, `memtrace.record_retrieved_chunks(documents)` records what the retrieval returned (strings, dicts with `text` / `id` / `source` / `score`, or LangChain documents; list order is the rank). The count is always recorded; the chunk text only when content capture is enabled. LangChain retrievers do this automatically.

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

## MCP tools

A tool served by an MCP server looks like any other tool in a span. To let MemTrace know which server it came from, the span carries `memtrace.mcp_server`; the assistant's *Connections* tab then lists the server and its usage.

With Pydantic AI it is automatic: `enable_pydantic_ai_instrumentation()` names the server after the toolset's `id` (or, without one, the name the server announces). Give your toolsets an `id` (`MCPToolset` in Pydantic AI 2.x):

```python
MCPToolset("https://weather.example/mcp", id="weather-mcp")
```

With any other framework, or a tool you wrap yourself, set it on the step:

```python
@trace_step(name="get_forecast", step_type="tool", attributes={"memtrace.mcp_server": "weather-mcp"})
def get_forecast(city: str) -> str: ...
```

## Custom step trees (fine-grained, non-LLM steps)

`step_type` isn't limited to the six built-in values — any string works. This lets you trace steps that aren't LLM calls (a regex check, a rules-based classifier, a validation library) as their own spans, nested under whatever node runs them. Nesting is automatic: any step opened inside a `trace_step`/`trace_step_context` block becomes its child.

Example: a LangGraph input guardrail node made of several non-generative checks, each visible in the dashboard as its own child span. Use `@trace_step` (not the bare context manager) so each check's argument and return value are captured as the span's input/output when [content capture](./configuration#privacy-and-content-capture) is on:

```python
from memtrace import trace_step

@trace_step(name="guardrail.regex_pii", step_type="guardrail.regex_pii")
def check_regex_pii(user_message: str) -> bool:
    return bool(PII_REGEX.search(user_message))

@trace_step(name="guardrail.toxicity_rules", step_type="guardrail.toxicity_rules")
def check_toxicity_rules(user_message: str) -> bool:
    return toxicity_classifier.predict(user_message)

@trace_step(name="input_guardrail", step_type="chain")
def run_input_guardrail(user_message: str) -> bool:
    pii_found = check_regex_pii(user_message)
    is_toxic = check_toxicity_rules(user_message)
    return pii_found or is_toxic
```

Call `run_input_guardrail` from *inside* the step that also invokes the agent (a `trace_step`/`trace_step_context` wrapping the whole turn), not on its own — otherwise the guardrail and the agent's own spans end up as two separate traces instead of one:

```python
with trace_step_context("conversation_turn", step_type="chain"):
    if run_input_guardrail(user_message):
        ...  # blocked
    else:
        agent.invoke(...)  # its spans nest under "conversation_turn" too
```

Recommended naming: a dotted namespace scoped to the use case (`guardrail.regex_pii`, `guardrail.toxicity_rules`), so the steps group visually and don't collide with the built-in `StepType` values. Any string works, so you don't need to declare custom step types in advance.

A runnable version of this example is in `examples/03_langchain_agent_manual.py` in the repository.
