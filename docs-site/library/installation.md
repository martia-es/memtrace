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
| `otel-langchain` | `pip install "memtrace-ai[otel-langchain]"` | Automatic LangChain instrumentation |

Pydantic AI needs no extra: install `pydantic-ai` alongside.
