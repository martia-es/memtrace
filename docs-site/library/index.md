# Library

`memtrace-ai` is the Python SDK that instruments your agent and exports traces over OTLP, following the OpenTelemetry [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (`gen_ai.*`).

It only talks to an OTLP endpoint. It knows nothing about where traces are stored, so your agent code doesn't change if the backend does.

- **Decorators** to trace functions and tools, sync or async.
- **`trace_llm_call`** to record model, tokens and messages on the current span.
- **Conversations**: group the turns of a chat into one conversation.
- **Integrations** for LangChain / LangGraph and Pydantic AI.
- **Safe by default**: prompts and completions are not captured unless you enable it, and the SDK never raises into your code.

<div class="mt-cards">
  <a class="mt-card" href="./installation"><span class="mt-card-tag">Start</span><strong>Installation</strong><span>Install memtrace-ai and its extras.</span></a>
  <a class="mt-card" href="./quickstart"><span class="mt-card-tag">Start</span><strong>Quickstart</strong><span>Your first trace in a few lines.</span></a>
  <a class="mt-card" href="./tracing"><span class="mt-card-tag">Core</span><strong>Tracing steps</strong><span>Decorators and trace_llm_call.</span></a>
  <a class="mt-card" href="./conversations"><span class="mt-card-tag">Core</span><strong>Conversations</strong><span>Group chat turns into one conversation.</span></a>
  <a class="mt-card" href="./integrations"><span class="mt-card-tag">Frameworks</span><strong>Integrations</strong><span>LangChain, LangGraph and Pydantic AI.</span></a>
  <a class="mt-card" href="./evaluation"><span class="mt-card-tag">Quality</span><strong>Offline evaluation</strong><span>Run experiments over datasets.</span></a>
</div>
