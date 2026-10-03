# Anonymizing personal data

MemTrace masks **secrets** (API keys, passwords, tokens) on its own. **Personal data** (names, emails, phone numbers, national IDs, card numbers) has no fixed shape, so it is anonymized only if you turn it on. This page shows how, so that nothing personal reaches the platform's storage.

## Why anonymize in the SDK

With content capture on, prompts, completions and tool arguments are stored as trace data. Anonymizing in the SDK, before spans are exported, means personal data never leaves your process in clear text, so nothing downstream has to be trusted to clean it.

Your options, from strongest to most flexible:

1. **Do not capture content** (`MEMTRACE_CAPTURE_CONTENT=false`, the default). Only names, timings, models and token counts are stored. Nothing personal can leak, but the dashboard has no transcripts.
2. **Capture content and anonymize it** with the steps below.
3. **Capture content as is**, only if your data policy allows it. Secrets are still masked.

## Install

```bash
pip install "memtrace-ai[pii]"
python -m spacy download en_core_web_sm      # English
python -m spacy download es_core_news_md     # Spanish
```

The extra installs [Microsoft Presidio](https://microsoft.github.io/presidio/) and spaCy. The language model is a separate download because it is large. Nothing is loaded unless you ask for it: `import memtrace` never imports any of this.

::: tip Using uv?
`python -m spacy download` needs pip, which uv environments do not include. Install the model wheel directly instead:

```bash
uv pip install "es-core-news-md @ https://github.com/explosion/spacy-models/releases/download/es_core_news_md-3.8.0/es_core_news_md-3.8.0-py3-none-any.whl"
```

Or declare it as a dependency in your `pyproject.toml` with the same URL.
:::

## Turn it on

```python
from memtrace import init_tracer
from memtrace.pii import presidio_redactor

init_tracer(redact=presidio_redactor(language="es"))
```

With `MEMTRACE_CAPTURE_CONTENT=true`, a span that would have stored

```text
Hola, soy María García, mi DNI es 12345678Z y mi correo maria@example.com
```

is exported as

```text
Hola, soy <PERSON>, mi DNI es <ES_NIF> y mi correo <EMAIL_ADDRESS>
```

It runs on every span before export, whatever created it: your `@trace_step` functions, LangChain, Pydantic AI, or any auto-instrumented library. Structure is preserved: in a list of chat messages only the text is rewritten; roles, token counts and IDs are left alone.

`presidio_redactor` loads the model when you call it, so a missing extra or model fails at startup, not silently later:

- no `pii` extra: `ImportError`
- model not downloaded: `RuntimeError` with the exact `spacy download` command to run

## What it detects

By default: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IBAN_CODE`, `IP_ADDRESS`, `CRYPTO`, `MEDICAL_LICENSE`, `US_SSN`, `US_PASSPORT`, `US_ITIN`, `US_DRIVER_LICENSE`, `US_BANK_NUMBER`, `UK_NHS`, and for Spanish `ES_NIF` and `ES_NIE`.

Locations, organizations, dates and URLs are **off by default**: they are common in harmless text (a weather agent asked about "San Francisco" would have every trace masked). Ask for them if you need them.

## Options

```python
presidio_redactor(
    language="es",
    entities=["PERSON", "EMAIL_ADDRESS", "LOCATION"],   # replace the default list
    score_threshold=0.5,                                # mask only findings at least this confident (0-1)
    models={"es": "es_core_news_lg"},                   # a larger model than the default
    allow_list=["Acme", "MemTrace"],                    # exact strings that are never masked
)
```

| Option | Default | Notes |
|---|---|---|
| `language` | `"en"` | One language per redactor. `"en"` and `"es"` work out of the box; for others pass `models` |
| `entities` | the list above | Any [Presidio entity](https://microsoft.github.io/presidio/supported_entities/) the language supports |
| `score_threshold` | `0.4` | Raise it to mask less (fewer false positives), lower it to mask more |
| `models` | `en_core_web_sm`, `es_core_news_md` | Any spaCy model name per language. Larger models (`lg`, `trf`) find names better but use more memory and time |
| `allow_list` | none | Company or product names that look like people or places |

## Accuracy and cost

- **It is not perfect.** Names are found with a statistical model, so some are missed and some ordinary words are masked (the small Spanish model, for instance, masks "Hola" as a person, which is why the default is the medium one). Try a larger model and tune `score_threshold` and `allow_list` on your own traffic, then look at real traces in the dashboard before relying on it.
- **Speed.** A few milliseconds per distinct text with the default models. Results are cached per text, so a conversation history that is resent on every turn is analyzed once. It runs in the background exporter thread, not in your agent's request path; under very heavy traffic the export queue can back up (see `MEMTRACE_BATCH_MAX_QUEUE_SIZE`).
- **Language.** Text in another language than the one configured is analyzed with the wrong model. Names in mixed-language text are the usual miss.
- **Session ids are not anonymized.** `session("...")` ids appear in dashboard URLs; use an opaque id, never an email or a name.

## Your own rules

`presidio_redactor` is built on the general `redact` hook. To plug in any other detector, or a couple of regular expressions, wrap a `str -> str` function with `text_hook`. It applies your function to every string in the span's content and keeps the structure:

```python
import re
from memtrace import init_tracer
from memtrace.pii import text_hook

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
init_tracer(redact=text_hook(lambda text: EMAIL.sub("<email>", text)))
```

If your function raises, MemTrace exports a placeholder instead of the original content: a bug in a redactor never leaks data. See [Configuration](./configuration#redaction) for how the built-in secret masking and the hook fit together.
