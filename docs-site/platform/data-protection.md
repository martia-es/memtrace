# Data protection

What MemTrace does so that personal data does not end up in its storage. This page covers the platform side; the agent side is in [Anonymizing personal data](/library/pii).

## Personal data never reaches the database

Prompts, completions and tool arguments are stored as trace data when content capture is on. Personal data is stopped in layers, **before** anything is written:

| Layer | Where | Catches | Needs |
|---|---|---|---|
| **No content** | Your agent (`MEMTRACE_CAPTURE_CONTENT=false`, the default) | Everything: prompts and answers are never sent | Nothing. The dashboard has no transcripts |
| **SDK anonymization** | Your agent, before export | Everything Presidio recognizes, **including names** | `init_tracer(redact=presidio_redactor())`, see [Anonymizing personal data](/library/pii) |
| **Collector masking** | The platform, before the write to ClickHouse | Personal data with a fixed format, from **every** agent | Nothing: always on |

Every mask is the same fixed `****`, whatever the type or length of the data, so it also hides how long the original was.

### What the Collector masks

| Data | Examples |
|---|---|
| Email addresses | `maria.garcia+x@example.co.uk` |
| Card numbers | `4111 1111 1111 1111`, `4111111111111111`, Amex |
| IBAN | `ES91 2100 0418 4502 0005 1332` |
| Spanish DNI and NIE | `12345678Z`, `X1234567L` |
| US Social Security numbers | `123-45-6789` |
| Phone numbers | `+34 612 345 678`, `612 345 678`, `612-34-56-78` |
| IPv4 addresses | `192.168.10.25` |

It looks at every attribute of every span, at the events attached to a span (exception messages included) and at the error message of a span. Trace ids, timestamps, versions and token counts are left alone.

### What it cannot catch

- **Names and free text** (`soy Ana`) have no fixed format. Only the SDK's Presidio layer finds them, and only if the agent turned it on. If your agents handle people's names, enable it or do not capture content.
- A 9-digit phone number written with no spaces or dashes (`612345678`) looks like any other number and is not masked.
- IPv6 addresses.

These patterns are part of the Collector configuration (`k8s/40-otel-collector.yaml`, processor `transform/pii`); an operator can add more.
