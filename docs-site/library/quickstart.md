# Quickstart

With a MemTrace stack running (see [Run it locally](/platform/getting-started)), send traces through its ingest gateway with the API key of your experiment (see [Authentication](/library/authentication)). Traces that arrive any other way carry no experiment and nobody can see them.

```python
from memtrace import init_tracer, trace_step, trace_llm_call, shutdown

init_tracer(
    service_name="my-agent",
    protocol="http/protobuf",                          # the default, shown for clarity
    endpoint="http://localhost:8080/api/v1/ingest",
    headers={"authorization": "Bearer mtk_..."},
)

@trace_step(name="search", step_type="tool")
def search(query: str) -> str:
    return f"results for {query}"

@trace_step(name="answer", step_type="llm")
def answer(prompt: str, context: str) -> str:
    reply = f"Based on: {context}"
    trace_llm_call(
        provider="openai",
        model="gpt-4o",
        input_tokens=180,
        output_tokens=52,
        input_messages=[{"role": "user", "content": prompt}],
        output_messages=[{"role": "assistant", "content": reply}],
    )
    return reply

@trace_step(name="run_agent", step_type="agent")
def run_agent(question: str) -> str:
    return answer(question, search(question))

run_agent("What is MemTrace?")
shutdown()  # flush pending spans before the process exits
```

Open the dashboard: the run appears as one trace, with the `tool` and `llm` spans nested under the `agent` span.

::: tip Short-lived processes
Spans are batched. In scripts and serverless functions call `flush()` (keeps the tracer) or `shutdown()` (closes it) before exiting, or the last spans can be lost.
:::

::: tip Not using the MemTrace platform?
Point `endpoint` at your own OpenTelemetry Collector, Jaeger, Tempo or any other OTLP backend and drop the `authorization` header. See [Bring your own backend](./bring-your-own-backend).
:::

More runnable agents are in the repository's `examples/` folder.
