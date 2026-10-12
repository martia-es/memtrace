# ADR-095: Multi-Language SDK Contract: Python Is the Reference, a Shared Conformance Suite Keeps TypeScript Aligned

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

Until now MemTrace had one SDK (Python, [ADR-006](adr-006-python-sdk-design.md)). Everything the platform reads from an agent is an implicit contract defined by that code: span attributes, resource attributes, the HTTP calls for prompts, feedback and evaluation, and the environment variables. The API, the Collector, ClickHouse columns and the dashboard depend on it ([ADR-004 semconv](../README.md), ADR-062, ADR-065, ADR-068).

F6 adds a TypeScript SDK with the same scope as the Python one, and more framework adapters (LangGraph, OpenAI Agents SDK, LangChain.js). With two implementations, an attribute spelled differently in one of them silently breaks a dashboard column, the deploy gate or the prompt evidence, and nobody notices until data is missing.

## Decision Outcome

1. **The contract is the list below, and Python is its reference implementation.** `sdk/python/memtrace/domain/semconv.py` stays the source of the attribute names. Changing the contract means changing Python first and updating this ADR (or superseding it).
2. **A language-neutral conformance suite** lives in `sdk/conformance/`: JSON fixtures (`scenario → expected spans and HTTP requests`). Each SDK runs the same fixtures in its own test suite, with an in-memory span exporter and a mocked HTTP transport. A new SDK is "done" when it passes them all.
3. **One repository, one folder per language**: `sdk/python/`, `sdk/typescript/`. The npm package is `@memtrace-ai/sdk`; the PyPI one stays `memtrace-ai`. Versions are independent; a contract change bumps the minor of both.
4. **No LLM vendor in the core of any SDK.** Judges and `propose_fix` depend on a minimal `LLMClient` (`complete(system, prompt, model?) → text | LLMReply`, optional `model`), as in [ADR-029](../README.md#retired-adrs) for Python. TypeScript has the same interface; vendor adapters (Anthropic today) are optional extras and are never the default.
5. **Personal-data masking has two layers in both languages** ([ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)): fixed formats in the Collector (always on), and an opt-in client layer for names and free text. Python runs Presidio and spaCy in the process; TypeScript, which has no Presidio engine, asks a Presidio analyzer service (the official image) and applies the same `****` mask locally, so it detects the same entities with the same models. The fixtures fix only the output (`****`), not the engine.

### The contract

**Resource attributes** (set once at init): `service.name`, `service.version`, `deployment.environment.name`, `vcs.repository.ref.revision` (from `MEMTRACE_GIT_SHA`, then `GITHUB_SHA`; [ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md)), `memtrace.revision.dirty`. The gateway rejects a resource whose `service.name` is not the experiment's ([ADR-085](../identity/adr-085-ingest-gateway-validates-service-name.md)).

**Span attributes**: OpenTelemetry GenAI names (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.conversation.id`, `gen_ai.request.*`, `gen_ai.response.*`, `gen_ai.usage.{input,output,total}_tokens`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.name`, `gen_ai.tool.call.{id,arguments,result}`) plus the MemTrace ones, only where no standard exists:

| Attribute | Meaning |
|---|---|
| `memtrace.step_type` | `chain`, `llm`, `tool`, `retriever`, … |
| `memtrace.framework` | Detected framework (`langchain`, `langgraph`, `openai-agents`, …) |
| `memtrace.input` / `memtrace.output` / `memtrace.metadata` / `memtrace.tags` | Content captured by the manual API |
| `memtrace.mcp_server` | MCP server a tool ran on; absent for local functions |
| `memtrace.retriever.documents` / `memtrace.retriever.chunks` | Retrieval results, read by the RAG metrics |
| `memtrace.prompt.name` / `memtrace.prompt.version` | Prompt that produced the span ([ADR-068](../prompts/adr-068-prompt-handle-trace-link-and-usage-report.md)) |
| `memtrace.playground` | The span belongs to a playground run (excluded from evidence) |
| `memtrace.span.expired`, `memtrace.redaction_failed` | Set by the SDK when it closes a stale span or cannot mask content |

Sessions: the active session id goes in `gen_ai.conversation.id` on **every** span of the process, including those made by third-party instrumentation (`SessionSpanProcessor`). Evaluation opens one root span named `eval.item` per item.

**Content capture**: masked keys and truncation follow `MEMTRACE_REDACT_KEYS`, `MEMTRACE_CAPTURE_CONTENT` and `MEMTRACE_MAX_CONTENT_LENGTH` ([ADR-021](adr-021-sdk-explicit-tracer-provider-and-content-redaction.md)).

**HTTP calls** (base URL `…/api/v1/experiments/<id>`, `Authorization: Bearer <agent API key>`, JSON in camelCase):

| Call | Purpose |
|---|---|
| `GET /prompts/resolve?name=&tag=` or `&version=` or `&override=<token>` | Resolve a prompt; `If-None-Match` / `304` for refresh |
| `POST /prompts/drafts` | Create a draft only (ADR-072) |
| `POST /prompts/usage` | Report the version in use per environment (heartbeat) |
| `POST /traces/{traceId}/feedback`, `DELETE …` | 👍/👎 (ADR-062) |
| `GET /datasets/{id}/items[?version=]` | Dataset items |
| `POST /datasets/{id}/runs`, `POST …/runs/{runId}/items` | Open a run (with `revision {sha, dirty}`) and upload batches of up to 1000 items; resending is idempotent |

The prompt override header is `x-memtrace-prompt-override` ([ADR-071](../prompts/adr-071-playground-against-the-real-agent.md)). A prompt that cannot be resolved falls back to `default=` and then to the on-disk cache; `compile()` never touches the network.

**Environment variables**: the `MEMTRACE_*` set read by `config.py` (`ENABLED`, `SERVICE_NAME`, `SERVICE_VERSION`, `ENVIRONMENT`, `GIT_SHA`, `OTLP_ENDPOINT`, `OTLP_HEADERS`, `OTLP_PROTOCOL`, `API_URL`, `API_KEY`, the `BATCH_*` and `EXPORT_TIMEOUT_MS` knobs, `SPAN_TTL_SECONDS`, `MAX_ACTIVE_RUNS`, the prompt `*_SECONDS` and `CACHE_DIR`, `ALLOW_PROMPT_OVERRIDE`, and the content settings above). Same names and defaults in every language.

### Where the languages differ on purpose

Behaviour that is the same in both is fixed by the conformance scenarios; these differences are about the runtime and do not change what MemTrace receives:

* `prompts.get()` is `async` in TypeScript (Python blocks for a few seconds at startup); `compile()` is synchronous in both.
* The playground override is fetched **before** the request runs in TypeScript (`prompts.override` / `promptOverrideMiddleware`), because `compile()` cannot wait for the network; in Python `compile()` asks MemTrace itself.
* TypeScript has no OTLP/gRPC.
* Client-side PII in TypeScript needs a Presidio analyzer service the team runs (a local container or a sidecar), so the text of the spans is sent to it; if it stops answering, the content is replaced by `[UNSERIALIZABLE]` and never exported unmasked. The `redact` hook may be asynchronous, so spans reach the exporter a moment after they end (`flush()` waits for them).

## Alternatives Considered

* **Spec first (JSON Schema / OpenAPI for everything), then both SDKs generated from it.** Cleaner on paper, but the attributes are plain strings and the HTTP surface is small; a schema would be a third thing to keep in sync. Rejected in favour of Python-as-reference plus runnable fixtures.
* **TypeScript in its own repository.** Independent release cycle, but the contract would drift and the API tests could not exercise both SDKs against the same server. Rejected.
* **Reduced TypeScript scope (traces and feedback only).** Cheaper, but a team using TypeScript would have no prompt registry or evaluation. Rejected: the decision is parity with Python.
* **Anthropic as the default judge in both SDKs.** Simpler to start, but ties evaluation to a vendor. Rejected: the interface is open and vendors are adapters.

## Consequences

* **Positive**: a divergence fails in CI instead of showing up as a missing dashboard column; adding a third language or framework adapter has a clear acceptance test; the contract is written down in one place.
* **Negative**: every contract change touches both SDKs and the fixtures; the TypeScript PII path depends on a service that Python does not need, and the fixtures cannot prove both detect the same entities.
* **Follow-up**: build `sdk/conformance/` from the Python behaviour before writing the TypeScript SDK; add `@memtrace-ai/sdk` publishing and CI when the first TypeScript piece lands.
