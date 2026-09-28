# Library

`memtrace-ai` is the Python SDK that instruments your agent and exports traces over OTLP, following the OpenTelemetry [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (`gen_ai.*`).

It only talks to an OTLP endpoint. It knows nothing about where traces are stored, so your agent code doesn't change if the backend does.

- **Decorators** to trace functions and tools, sync or async.
- **`trace_llm_call`** to record model, tokens and messages on the current span.
- **Conversations**: group the turns of a chat into one conversation.
- **Integrations** for LangChain / LangGraph and Pydantic AI.
- **Safe by default**: prompts and completions are not captured unless you enable it, and the SDK never raises into your code.

Start with [Installation](./installation) and the [Quickstart](./quickstart).
