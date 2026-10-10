# Changelog

## Unreleased

### Changed
- **Masks are now `****`** everywhere. Secrets were masked as `[REDACTED]` and `presidio_redactor` replaced personal data with `<ENTITY_TYPE>` (`<PERSON>`, `<ES_NIF>`...); both now use the same fixed `****`, which also hides the length of the data. Code or dashboards that matched the old strings must be updated; `memtrace.domain.serialization.REDACTED` keeps pointing at the mask.

### Fixed
- `enable_pydantic_ai_instrumentation()` and `enable_langchain_instrumentation()` now send their spans
  through the tracer configured by `init_tracer()`. Before, they used the process-global OpenTelemetry
  provider, which MemTrace never sets, so **no spans were exported**.
- Both auto-instrumentations now respect `MEMTRACE_CAPTURE_CONTENT` (prompts and completions were
  always recorded before).
- Spans created by auto-instrumented libraries inside `with session(...)` now carry that session id.
- The `otel-langchain` extra installs `langchain-core` and, on Python 3.9, `wrapt<2`.

### Added
- `prompts.propose_fix(name, cases, llm)` and `prompts.save_draft(...)` (ADR-072): ask **your** LLM (any object with `complete(system=, prompt=)`, like the judges' client) for a fix of a prompt from `FixCase`s and save it in MemTrace as a **draft** for a person to review, test and publish. A proposal that changes the prompt's `{{variables}}` or leaves it unchanged is refused (`FixProposalError`) and nothing is saved. Asking for a draft by number (`prompts.get(name, version=N)`, to evaluate it) logs a warning.
- Prompt playground in the real agent (ADR-071): `PromptOverrideMiddleware` (ASGI) and `prompts.override(token)` let MemTrace run another prompt version in this agent for a single request. Opt-in with `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`; a token MemTrace does not recognize, or MemTrace being down, serves the normal version. The span is marked `memtrace.playground=true`.
- `memtrace.langchain.prompt_middleware(handle, **variables)`: a registry prompt as the system prompt of a LangChain 1.x `create_agent`
  agent, resolved on every model call so the agent follows its tag without being rebuilt (sync and async; a variable can be a function
  of LangChain's `ModelRequest`). New `langchain-agents` extra. See ADR-068.
- Prompt registry: `memtrace.prompts.get(name, tag=... | version=..., default=...)` returns a handle that is compiled per request
  (`handle.compile(**variables)`, in memory, no network) and follows its tag in the background, so moving a tag in MemTrace reaches
  the agent without a restart. `compile()` writes `memtrace.prompt.name` / `memtrace.prompt.version` on the current span, the SDK
  reports the version in use per environment, and the last versions can be kept on disk (`MEMTRACE_PROMPT_CACHE_DIR`) to start
  while MemTrace is down. `prompts.aget()` for async code, `handle.as_callable()` for frameworks that take a function (Pydantic AI
  `instructions`). Needs the `eval` extra, `MEMTRACE_API_URL` and `MEMTRACE_API_KEY`. See ADR-067 and ADR-068.
- Every trace carries the commit of the running code as the resource attribute `vcs.repository.ref.revision` (and `memtrace.revision.dirty` when known). Read from `MEMTRACE_GIT_SHA`, `GIT_SHA`, CI/platform variables or `git`. See ADR-065.
- `MemTraceResultsSink` records the evaluated commit (and whether the working tree had uncommitted changes) on each run, so a deployment can require an evaluation of exactly the commit it ships. See ADR-064/065.
- End-user feedback: `memtrace.feedback(trace_id, "up" | "down", end_user_id=..., comment=...)` sends a 👍/👎 about an
  answer and links it to its trace, `memtrace.retract_feedback(...)` withdraws it, and `memtrace.current_trace_id()` gives the
  trace id to hand back to the UI with the answer. Needs the `eval` extra, `MEMTRACE_API_URL` and `MEMTRACE_API_KEY`. See ADR-062.
- MCP tool spans carry `memtrace.mcp_server`: `enable_pydantic_ai_instrumentation()` names the server (toolset `id`,
  else the name the server announces) on the tool span, so the assistant registry detects MCP servers and measures
  their calls and errors. Other frameworks set it with `trace_step(..., attributes={"memtrace.mcp_server": ...})`. See ADR-056.
- `eval-judges` extra and `memtrace.eval_judges` module: `Correctness` and `Faithfulness`,
  LLM-as-judge evaluators built on a new `LLMJudgeEvaluator` base class and `LLMClient` port
  (`application/eval_ports.py`), plus a default `AnthropicJudgeClient` adapter. Both drop into
  `run_experiment(evaluators=[...])` alongside `exact_match`/`contains`. See ADR-029.
- `pii` extra and `memtrace.pii` module: `presidio_redactor()` anonymizes personal data (names, emails,
  phones, cards, IBAN, DNI/NIE…) before export using Microsoft Presidio, and `text_hook()` turns any
  `str -> str` function into a `redact` hook. Optional: nothing is imported unless you use it.
- Redaction of everything that is exported, for every span whatever its origin (decorators, LangChain,
  Pydantic AI, any auto-instrumented library): secrets are masked by key name (`api_key`, `password`,
  `authorization`, …, extendable with `MEMTRACE_REDACT_KEYS`) and by shape (`sk-…`, JWTs, `Bearer …`, URL
  credentials, `password=…`), in attributes, exception messages and error statuses. An
  `init_tracer(redact=...)` hook handles what has no fixed shape (emails, names). It fails closed.
- Auto-instrumented spans (Pydantic AI, LangChain) now carry `memtrace.step_type`, derived from their
  GenAI attributes, so the dashboard classifies agents and tools instead of showing `unknown`.
- `enable_langchain_instrumentation()` survives `shutdown()` / `init_tracer()` (notebooks, tests): the
  instrumentor is bound to a process-wide switchable provider. Late spans are dropped quietly.
- Captured payloads are bounded (depth, items, string length) *before* serialization.
- `MEMTRACE_MAX_ACTIVE_RUNS` caps in-flight spans; a background reaper now expires orphaned spans even
  when no new spans arrive.
- `init_tracer()` logs a warning when called again with different arguments (it used to ignore them silently).
- `service=` argument on `trace_step`, `trace_step_context` and `trace_llm_call` to use an explicit tracer.
- `trace_llm_call` accepts `frequency_penalty` and `presence_penalty`.
- `pydantic-ai` extra, `py.typed` marker, package metadata, CI on Python 3.9-3.13.

### Changed
- **Breaking:** in `trace_llm_call`, everything after `provider` and `model` is keyword-only.
- All log messages, errors and docstrings are now in English.
