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

## How long traces are kept

By default traces are kept for **30 days**. An `org_admin` can change it in **Admin › organization › Data protection**:

- **Organization default**: from 1 to 365 days, for every experiment of the organization.
- **Own period for an experiment**: an agent that handles sensitive data can keep its traces for less time than the rest. It can be shorter than the organization's period, never longer. Leave it empty to use the organization's.

Every night (03:30 UTC) MemTrace deletes the spans and extracted topics older than the period of each experiment. If you shorten the organization's period, the own periods that were longer than the new one are removed (they would mean the same). Changes and deletions are recorded in the audit log.

What it covers and what it does not:

| | |
|---|---|
| **Deleted when it expires** | Spans (traces, with their prompts and answers if content capture is on) and the topics extracted from them |
| **Not deleted** | Evaluation scores, human annotations and end-user feedback. They are not traces; feedback must outlive the trace it refers to. The text of evaluation run items has its own limit of 180 days |

::: tip The dashboard looks as far back as you keep
You can keep traces for up to 365 days and the dashboard (lists, metrics, search) can show up to a year: use the **90 d** and **1 y** presets of the time range, or pick a custom range. Anything older than the period you set no longer exists, so a range that reaches past it simply shows less. Long periods are also what lets you [export](#export-your-data) older traces, for example for an audit. Wide ranges read more data, so charts over a year are slower than over a day. Every span is stored with the id of its experiment, so two organizations that use the same `service.name` keep their own period. Spans stored before that id existed are only deleted after they have been assigned an experiment (see `make backfill-experiment-id`).
:::

Operators: the job is the `retention-purge` CronJob. To run it now, `kubectl -n memtrace create job --from=cronjob/retention-purge purge-now`.

## The audit log

**Admin › organization › Data protection › Audit log** answers "who looked at what". It records:

| Action | When |
|---|---|
| Opened a trace / a conversation | A person opened the content of a trace or a conversation. Opening the same one again within five minutes counts once |
| Exported data | Every export, with the kind of data, the range and the number of records |
| Changed retention / Deleted expired traces | A person changed a period, or the nightly job deleted something |
| Added a member, created or revoked an API key | Changes of who has access |
| Created or revoked a partner relationship or a partner grant; a consultancy person entering your data | See [Access control](/platform/access-control). Entering is recorded at most once per person and experiment every five minutes, and your own staff's reads are not marked as partner access |
| Created, changed or deleted an alert; set or removed the cost budget | Changes to what is monitored and who is emailed (the log keeps how many addresses, not the addresses) |

Lists, metrics and dashboards are **not** recorded: they carry no content and would bury the entries that matter. The log stores identifiers (which trace, which person), never the content itself. Entries cannot be edited or deleted from MemTrace and are removed after one year. Reading the log needs the `audit:read` permission, which `org_admin` has.

## Export your data

**Admin › organization › experiment › Export** downloads the data of an agent as a [JSON Lines](https://jsonlines.org) file, one record per line:

| Kind | Content |
|---|---|
| Traces | Every span, with its attributes (and prompts and answers if content capture is on) |
| Human annotations | The labels people put on traces |
| End-user feedback | Thumbs up and down from the people using the agent |
| Evaluation scores | Results of the offline evaluations |

Pick the kind and a range of up to 31 days, press **Prepare export** to see how many records it has, then **Download**. A file can have at most 2,000,000 records: choose a shorter range if it is more. Every export is recorded in the audit log before it starts; if it cannot be recorded, it does not happen.

Exporting needs the `data:export` permission, which the `technical` profile has. `org_admin` does not: it manages people and settings but, by design, does not read the data of the agents. The same endpoint is in the [Query API](/platform/api#data-protection-adr-084).
