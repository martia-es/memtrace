# Installation

The package is published on PyPI as `memtrace-ai`; the Python import is `memtrace`. Python 3.9 or later.

```bash
pip install memtrace-ai
```

## Extras

| Extra | Install | Adds |
|---|---|---|
| `http` | `pip install "memtrace-ai[http]"` | OTLP/HTTP exporter (needed for [API-key authentication](./authentication)) |
| `langchain` | `pip install "memtrace-ai[langchain]"` | `MemTraceCallbackHandler` for LangChain / LangGraph |
| `langchain-agents` | `pip install "memtrace-ai[langchain-agents]"` | [`prompt_middleware`](./prompts#frameworks-that-freeze-the-prompt): registry prompts for LangChain 1.x `create_agent` agents (Python 3.10+) |
| `otel-langchain` | `pip install "memtrace-ai[otel-langchain]"` | Automatic LangChain instrumentation |
| `pydantic-ai` | `pip install "memtrace-ai[pydantic-ai]"` | Automatic Pydantic AI instrumentation (or install `pydantic-ai` yourself) |
| `pii` | `pip install "memtrace-ai[pii]"` | [Anonymization of personal data](./pii) with Presidio (also needs a spaCy model) |
| `eval` | `pip install "memtrace-ai[eval]"` | [Offline evaluation](./evaluation) against MemTrace datasets and uploading results; also the HTTP client of [user feedback](./feedback) and of the [prompt registry](./prompts) |
| `eval-judges` | `pip install "memtrace-ai[eval-judges]"` | Bundled `AnthropicJudgeClient` for [LLM-as-judge evaluators](./evaluation#llm-as-judge-evaluators) |
