# Installation

MemTrace has two SDKs that send the same traces, with the same attribute names, masking and environment variables, so one project can mix agents written in both.

| | Python | TypeScript / Node.js |
|---|---|---|
| Package | `memtrace-ai` on PyPI (the import is `memtrace`) | `@memtrace-ai/sdk` on npm |
| Requires | Python 3.9 or later | Node.js 18 or later |

::: code-group

```bash [Python]
pip install memtrace-ai
```

```bash [TypeScript]
npm install @memtrace-ai/sdk
```

:::

Traces are sent over **OTLP/HTTP** by default, and that exporter is part of the base install, so nothing else is needed to send to the MemTrace platform or to any OTLP/HTTP collector. The old `http` extra still installs, but it no longer adds anything.

## Extras and optional packages

In Python they are extras; in TypeScript, the framework packages are optional peer dependencies that you install yourself.

### Python

| Extra | Install | Adds |
|---|---|---|
| `grpc` | `pip install "memtrace-ai[grpc]"` | OTLP/gRPC exporter, only to send to a collector that listens on gRPC only (see [Bring your own backend](./bring-your-own-backend)). The MemTrace platform does not accept gRPC |
| `langchain` | `pip install "memtrace-ai[langchain]"` | `MemTraceCallbackHandler`, [`prompt_middleware`](./prompts#frameworks-that-freeze-the-prompt) (LangChain 1.x `create_agent`, Python 3.10+) and automatic instrumentation for LangChain / LangGraph |
| `pydantic-ai` | `pip install "memtrace-ai[pydantic-ai]"` | Automatic Pydantic AI instrumentation (or install `pydantic-ai` yourself) |
| `openai-agents` | `pip install "memtrace-ai[openai-agents]"` | Automatic [OpenAI Agents SDK](./integrations#openai-agents-sdk) instrumentation |
| `pii` | `pip install "memtrace-ai[pii]"` | [Anonymization of personal data](./pii) with Presidio (also needs a spaCy model) |
| `eval` | `pip install "memtrace-ai[eval]"` | [Offline evaluation](./evaluation) against MemTrace datasets and uploading results; also the HTTP client of [user feedback](./feedback) and of the [prompt registry](./prompts); also the bundled `AnthropicJudgeClient` for [LLM-as-judge evaluators](./evaluation#llm-as-judge-evaluators) |

### TypeScript

| Subpath | Install the framework | Adds |
|---|---|---|
| `@memtrace-ai/sdk/langchain` | `npm install @langchain/core` | `MemTraceCallbackHandler` for LangChain.js and LangGraph.js |
| `@memtrace-ai/sdk/openai-agents` | `npm install @openai/agents` | `enableOpenAIAgentsInstrumentation` for the [OpenAI Agents SDK](./integrations#openai-agents-sdk) |

Feedback, the prompt registry and offline evaluation are part of the main package, with nothing else to install. [Personal data masking](./pii) with Presidio needs a Presidio analyzer service, because Presidio has no JavaScript engine.

The TypeScript SDK exports over OTLP/HTTP only; there is no OTLP/gRPC, which the MemTrace platform does not accept anyway.
