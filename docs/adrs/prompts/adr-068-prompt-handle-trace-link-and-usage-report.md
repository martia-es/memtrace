# ADR-068: Prompt Handle in the SDK, Trace Link and Usage Report

* **Status**: Accepted — implemented (2026-10-08)
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md)
* **Related**: [ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md), [ADR-062](../observability/adr-062-end-user-feedback-on-traces.md), [ADR-006](../sdk/adr-006-python-sdk-design.md)

## Context and Problem Statement

ADR-067 stores prompts, versions and environment tags. Nothing used them yet: an agent has to read its prompt from the registry, and MemTrace has to know **which version produced each trace** and **which version each environment is really running**, which the tag alone does not say (an agent may not have restarted, a replica may be stale, a pinned version ignores the tag).

Two facts shape the SDK: agents load prompts once (a `lifespan`), and a prompt on the request path of a chat agent cannot add network latency.

## Decision Outcome

### `prompts.get()` returns a handle, not text

`memtrace.prompts.get(name, tag=|version=, default=)` returns a `PromptHandle`. The agent keeps it and calls `handle.compile(**variables)` per request.

- **`compile()` is memory only**: it reads the version already held and substitutes `{{name}}` (values inserted as text, never re-expanded; a missing variable raises `MissingVariableError` listing all missing). It never calls the registry. Measured with a live span: p50 ≈ 18 µs, p99 ≈ 60 µs; a test enforces p99 < 1 ms and zero registry calls.
- **The tag is followed in the background.** One daemon thread per process asks `GET /prompts/resolve` every `MEMTRACE_PROMPT_REFRESH_SECONDS` (30) with `If-None-Match`; an unchanged tag is an empty `304`. A new version replaces the handle's version in one assignment, so a request never sees half of one. Failures keep the last version, warn once per streak and back off (×2 up to 5 minutes).
- **Default tag = environment.** With neither `tag` nor `version`, it follows the tag named like `MEMTRACE_ENVIRONMENT`. This is why environment tags are the organization's environment keys (ADR-067).
- **A pinned `version` is final**: immutable content, never refreshed.
- **Same prompt, same handle**: asking twice returns the cached handle and asks the registry once.
- Frameworks that freeze a string when the agent is built get `handle.as_callable()` instead (a function returning `compile()`): verified with Pydantic AI (`instructions` is re-evaluated each run) and with a LangChain runnable. A string passed at build time would freeze the version; the docs say so.

### Start-up and outages

- `get()` asks once, blocking up to `MEMTRACE_PROMPT_TIMEOUT_SECONDS` (3), so a wrong name or tag fails **at startup**: `PromptNotFoundError` is a configuration mistake and is **never** masked by `default=`.
- If MemTrace cannot be reached: the disk cache (`MEMTRACE_PROMPT_CACHE_DIR`, one atomic JSON file per prompt/tag, every error swallowed) → else `default=` (version 0, retried every ≤5 s until MemTrace answers) → else `PromptUnavailableError`.
- Without `MEMTRACE_API_URL` it works offline with `default=`. Prompts keep working with `MEMTRACE_ENABLED=false`: that flag turns tracing off, and a prompt is application logic.
- `aget()` runs `get()` in a thread for async lifespans. After `fork` (gunicorn `--preload`) the child starts its own thread (`os.register_at_fork`).

### The trace link: span attributes, materialized columns

`compile()` writes `memtrace.prompt.name` and `memtrace.prompt.version` on the **current span** (through `TracingService.annotate_current`, which already exists; failures never reach the agent). ClickHouse migration `012` adds `PromptName` (LowCardinality, bloom index) and `PromptVersion` (UInt32) as `MATERIALIZED` columns — the same pattern as `Revision` (ADR-065), so the collector does not change.

- The prompt is marked on the span that *uses* it, usually not the root. So the trace filter is `TraceId IN (spans with that prompt)`, and the span filter is direct. `GET /traces` and `GET /spans` accept `promptName` and `promptVersion`.
- The `default=` text has no version: it is never stamped nor reported.
- **Evaluation runs store no prompt column.** A run's items already carry `trace_id`, and their traces carry the stamp, so the prompts of a run are derived by joining; a second copy on the run would be a second source of truth. (This replaces the "run stores the prompts used" line of ADR-067.)

### The usage report: what really runs

The same thread reports `(name, tag followed or none, version)` of every held handle, with `MEMTRACE_ENVIRONMENT`, to `POST /prompts/usage`: immediately after the first load and after a tag moves, then every 5 minutes. Postgres table `prompt_usage` (migration 033), one row per `(prompt, agent, environment, tag, version)` refreshed by upsert, forgotten after 7 days.

- Several rows for the same environment are expected during a rolling update; the UI shows both.
- A row is **active** if reported in the last 15 minutes. The detail page derives *Up to date / Catching up / Fixed version / Not reporting* by comparing the reported version with the tag's current one, and marks versions as *Running in pro*.
- The endpoint ignores what does not fit (unknown prompt, another agent's, nonexistent version): a heartbeat must never fail the agent.

### API for the SDK

`GET /experiments/{id}/prompts/resolve?name=&tag=|version=` and `POST /experiments/{id}/prompts/usage`, both accepting the **agent API key** (the same `requireExperimentAccess` as datasets and feedback) or a session. A prompt is served **only to agents it is associated with** (ADR-067's `prompt_agents`), so linking is also the access rule. An archived prompt keeps being served: archiving must not break running agents. The ETag is `"v<version>-<hash16>"`.

## Consequences

- **Good**: moving a tag in the dashboard changes production behaviour in seconds with no deploy; every trace says which version made it; the dashboard shows the truth, not the intention; no request-path latency; MemTrace outages do not stop agents.
- **Cost**: a thread and an HTTP call every 30 s per process (empty `304`s) and a heartbeat every 5 min. Many replicas × many prompts is many small requests; acceptable now, and the interval is configurable.
- **Risk**: the code that builds an agent with `compile()`'s string still freezes the version. Mitigated by `as_callable()`, the docs and, later, the playground's compatibility marker.
- **Not here (later phases)**: per-request override for the playground, the evidence per version and the promotion gate. The handle resolves its version in one place, which is where the override will plug in.

## Alternatives considered

- **Server pushes changes (SSE/webhook)**: faster, but needs an inbound path to every agent or a long-lived connection; polling with `304` is simple, firewall-friendly and enough.
- **Fetch on every `compile()` with a TTL cache**: puts the network on the request path on cache misses; the background thread keeps it off.
- **Store the prompts used on the evaluation run**: duplicates what the traces already say.
- **Stamp the root span only**: simpler query, but the root is often created before the prompt is chosen, and it is not where the prompt is used.
