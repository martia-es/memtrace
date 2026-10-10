# Installation

The package is published on PyPI as `memtrace-ai`; the Python import is `memtrace`. Python 3.9 or later.

```bash
pip install memtrace-ai
```

Traces are sent over **OTLP/HTTP** by default, and that exporter is part of the base install, so nothing else is needed to send to the MemTrace platform or to any OTLP/HTTP collector. The old `http` extra still installs, but it no longer adds anything.

## Extras

| Extra | Install | Adds |
|---|---|---|
| `grpc` | `pip install "memtrace-ai[grpc]"` | OTLP/gRPC exporter, only to send to a collector that listens on gRPC only (see [Bring your own backend](./bring-your-own-backend)). The MemTrace platform does not accept gRPC |
| `langchain` | `pip install "memtrace-ai[langchain]"` | `MemTraceCallbackHandler`, [`prompt_middleware`](./prompts#frameworks-that-freeze-the-prompt) (LangChain 1.x `create_agent`, Python 3.10+) and automatic instrumentation for LangChain / LangGraph |
| `pydantic-ai` | `pip install "memtrace-ai[pydantic-ai]"` | Automatic Pydantic AI instrumentation (or install `pydantic-ai` yourself) |
| `pii` | `pip install "memtrace-ai[pii]"` | [Anonymization of personal data](./pii) with Presidio (also needs a spaCy model) |
| `eval` | `pip install "memtrace-ai[eval]"` | [Offline evaluation](./evaluation) against MemTrace datasets and uploading results; also the HTTP client of [user feedback](./feedback) and of the [prompt registry](./prompts); also the bundled `AnthropicJudgeClient` for [LLM-as-judge evaluators](./evaluation#llm-as-judge-evaluators) |
