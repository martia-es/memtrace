# ADR-028: Offline Evaluation as a Decoupled, Client-Side SDK Module

* **Status**: Accepted
* **Date**: 2026-09-30
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

MemTrace instruments agent execution (Fase 1) and secures access to that data (Fase 1.5), but offers no way to answer "is this agent good, and did this change make it better or worse?" — the evaluation vertical that tools like LangSmith, MLflow, and Langfuse also cover. Before adding it, we looked at how the two open-source ones (Langfuse, MLflow — LangSmith's backend is closed source) actually implement it, reading their code directly rather than only their docs:

- **Storage split**: Langfuse keeps `scores` in ClickHouse (`packages/shared/clickhouse/migrations/canonical/0003_scores.up.sql`), alongside `traces`/`observations`, because scores grow at the same rate as traces (one score per evaluator per span). It keeps `Dataset`/`DatasetItem`/`DatasetRuns` in Postgres (`packages/shared/prisma/schema.prisma`) because those are hand-curated, low-volume, referentially-integrous data.
- **Execution model**: MLflow's `mlflow.genai.evaluate()` (`mlflow/genai/evaluation/harness.py`) runs its `ThreadPoolExecutor`-based scoring pipeline **inside the caller's own process** — there is no MLflow-hosted service that orchestrates offline evaluation runs. Langfuse's `run_experiment()` (`langfuse-python/langfuse/experiment.py`) does the same.
- **Decoupling from the vendor's own store**: MLflow's `evaluate(data=...)` accepts an `EvaluationDataset` entity, a pandas/Spark DataFrame, a list of dicts, or a list of `Trace` objects — its own dataset type is one option among several, never mandatory. Langfuse's `TaskFunction`/`EvaluatorFunction` protocols (`experiment.py:598,672`) only ever see plain dicts or attributes (`input`, `output`, `expected_output`), never a Langfuse-specific object.

We need this same evaluation vertical, but the user has an explicit constraint: **the evaluation module of the SDK must not be hard-coupled to MemTrace's own API**. A user must be able to plug in their own dataset source and their own result handling, and still use MemTrace's evaluator/runner primitives standalone.

## Decision Outcome

1. **Offline only, in this phase.** Online evaluation (continuous sampling over production traffic, checkpointed background scoring — the model MLflow implements in `mlflow/genai/scorers/online/`) is explicitly deferred to a future phase. It requires a persistent backend service; offline does not, and mixing the two now would pull unnecessary infrastructure into this phase.

2. **The experiment runner executes client-side, not as a MemTrace service.** `run_experiment()` lives in the SDK and runs inside the user's own process (script, notebook, CI job), mirroring MLflow's and Langfuse's approach. MemTrace does not host or schedule evaluation runs in this phase.

3. **Two protocols, agnostic of MemTrace, define the pipeline the user implements:**
   ```python
   class Evaluator(Protocol):
       def __call__(self, *, input: Any, output: Any,
                     expected_output: Any | None, trace: Trace | None) -> Score: ...

   class TaskFunction(Protocol):
       def __call__(self, *, item: dict[str, Any]) -> Any: ...
   ```
   Both only ever see plain values (dicts, the SDK's existing `Trace` type from instrumentation) — never a MemTrace-only entity. An `Evaluator` written for MemTrace is portable to another dataset source without modification, and vice versa.

4. **Two ports isolate the only two places the SDK talks to MemTrace's backend, and both are optional:**
   - `DatasetSource`: `run_experiment(data=...)` accepts either a `dataset_id` string (which triggers the bundled `MemTraceDatasetSource` HTTP adapter to fetch items from the query API) or a plain local iterable of `{input, expected_output}` dicts the user already has, bypassing MemTrace's API entirely.
   - `ResultsSink`: by default, a `MemTraceResultsSink` adapter uploads the resulting `dataset_run` and its scores to the query API so they show up in the dashboard. Passing `upload=False` skips this and returns the result object to the caller, who can persist it however they choose.

   Both adapters live behind the same hexagonal boundary the SDK already uses (`sdk/python/memtrace/application` for the ports/protocols, `sdk/python/memtrace/adapters/outbound` for the HTTP implementation — see ADR-006, ADR-024), not as a special case.

5. **Storage split mirrors the volume/access-pattern criterion already established in ADR-013**: `scores` go into ClickHouse (append-heavy, same shape and query pattern as traces — one row per evaluator per trace); `dataset` / `dataset_item` / `dataset_run` go into the existing identity Postgres instance (curated, low-row-count, needs referential integrity).

6. **The query API (piece 4) only gains passive storage endpoints** (`/datasets`, `/datasets/:id/items`, `/datasets/:id/runs`, `/traces/:id/scores`, `/traces/:id/feedback`), all behind the existing Fase 1.5 authorization middleware. No orchestration logic moves server-side.

## Consequences

* **Positive**: no new deployment or backend service for this phase — minimal infrastructure cost. The evaluation module is useful standalone (a user can write and run `Evaluator`s against their own data before ever calling MemTrace's API), which lowers the barrier to try it. Consistent with the ports/adapters pattern already used throughout the SDK and the query API, so it does not introduce a new architectural style to maintain.
* **Negative**: no automatic evaluation of production traffic in this phase — a user must explicitly run an experiment (script/notebook/CI job); there is no managed scheduling. This is deferred, not solved, and will require revisiting this ADR (or a new one) when online evaluation is tackled, since that needs a persistent background service this decision deliberately avoids.
* **Compatibility**: purely additive. No change to existing trace ingestion (OTLP) or query contracts; existing SDK instrumentation APIs are untouched.

## Follow-up: implementing the backend (2026-09-30)

Building the query API side of point 6 surfaced two invariants of Fase 1/1.5 that this decision necessarily touches. Both were confirmed with the user before implementing:

1. **The query API's ClickHouse client was read-only by construction** (`clickhouse_settings: { readonly: "2" }`, with a comment stating "the API never writes to the store"). Persisting `scores` needs the API's first write path into ClickHouse. Resolution: a second client, `createScoresWriteClient`, used **exclusively** by `ClickHouseScoreRepository` — `ClickHouseTraceRepository` and the read-only client are untouched, so trace ingestion still only happens through the OTel Collector (piece 2), never through the query API.
2. **The query API had no machine (API-key) authentication at all** — every endpoint required an Auth.js session. `memtrace.eval`'s HTTP adapters authenticate as an agent, not a human. Resolution: `requireExperimentAccess(experimentId, request)` (`auth-context.ts`), which accepts an `Authorization: Bearer` API key — reusing `identityRepository.resolveApiKey`, the exact mechanism already validating keys at the OTLP ingest gateway (`ingest/v1/traces/route.ts`) — and falls back to the existing session check (`requireExperimentRead`) when no key is present. Only the two endpoints the SDK calls (`GET .../datasets/:id/items`, `POST .../datasets/:id/runs`) accept a key; every dashboard-only endpoint (create dataset, list runs, run detail) still requires a session.

Implementation detail worth recording: `EvaluationService.submitDatasetRun` writes to ClickHouse **before** creating the `dataset_runs` row in Postgres, using an id it generates itself (`randomUUID()`) and passes to both stores. This avoids a Postgres run record that points at a ClickHouse write that never happened — the failure mode of the reverse order.

**Known gap found running this end-to-end**: `EvalItemResult.trace_id` is populated from `get_current_run_id()`, which is MemTrace's own bookkeeping UUID (`tracing_service.py::start_run`, a fresh `uuid.uuid4()` per span), not the OTel-native 32-hex trace id the dashboard's trace viewer expects (`GET /traces/{traceId}`, validated by a `^[0-9a-fA-F]{32}$` regex). The two are different identifiers, so this field currently won't resolve to anything in the dashboard. Fixing it means exposing the real OTel trace id through `SpanPort`/`SpanHandle` (`application/ports.py`) from the OTel adapter — left as a follow-up, since it touches the adapter contract and every backend implementing it, and doesn't block seeing the score results themselves.

