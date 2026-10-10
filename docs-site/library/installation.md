# Installation

The package is published on PyPI as `memtrace-ai`; the Python import is `memtrace`. Python 3.9 or later.

```bash
pip install memtrace-ai
```

## Extras

| Extra | Install | Adds |
|---|---|---|
| `http` | `pip install "memtrace-ai[http]"` | OTLP/HTTP exporter (needed for [API-key authentication](./authentication)) |
| `langchain` | `pip install "memtrace-ai[langchain]"` | `MemTraceCallbackHandler`, [`prompt_middleware`](./prompts#frameworks-that-freeze-the-prompt) (LangChain 1.x `create_agent`, Python 3.10+) and automatic instrumentation for LangChain / LangGraph |
| `pydantic-ai` | `pip install "memtrace-ai[pydantic-ai]"` | Automatic Pydantic AI instrumentation (or install `pydantic-ai` yourself) |
| `pii` | `pip install "memtrace-ai[pii]"` | [Anonymization of personal data](./pii) with Presidio (also needs a spaCy model) |
| `eval` | `pip install "memtrace-ai[eval]"` | [Offline evaluation](./evaluation) against MemTrace datasets and uploading results; also the HTTP client of [user feedback](./feedback) and of the [prompt registry](./prompts); also the bundled `AnthropicJudgeClient` for [LLM-as-judge evaluators](./evaluation#llm-as-judge-evaluators) |
