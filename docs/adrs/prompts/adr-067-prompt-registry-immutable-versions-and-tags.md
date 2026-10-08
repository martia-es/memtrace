# ADR-067: Prompt Registry — Immutable Versions, Movable Tags and Evidence per Version

* **Status**: Proposed — phases 1, 2 and 3 implemented (2026-10-08); phase 2 in [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md), phase 3 in [ADR-069](adr-069-evidence-per-prompt-version.md)
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md), [ADR-053](../governance/adr-053-assistant-registry-data-model.md), [ADR-054](../governance/adr-054-experiment-is-an-agent.md), [ADR-064](../governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md), [ADR-065](../observability/adr-065-code-revision-on-traces-and-evaluations.md)

## Context and Problem Statement

Every comparable tool (Langfuse, LangSmith, PromptLayer) manages a prompt as a versioned text with labels. MemTrace already has traces, offline evaluation, datasets, annotations and an environment gate (ADR-064), so it can close the loop the others leave open: **a prompt version is a hypothesis with evidence**, and moving it to production is a decision backed by that evidence.

This ADR fixes the registry model (phase 1, implemented) and the direction of the rest, so phase 1 does not paint us into a corner.

## Decision Outcome

### Data model (PostgreSQL, migration `032_prompts.sql`)

- **`prompts`**: belongs to the **organization** (`organization_id`), unique `(organization_id, name)`; `name` is a slug (`^[a-z0-9][a-z0-9._-]{0,63}$`) because versions, traces and the SDK will reference it. Deleting is **archiving** (`archived_at`): versions and history are never lost.
- **`prompt_agents`** `(prompt_id, experiment_id)`: a prompt belongs to **one or many agents** (ADR-054: experiment = agent). It lets the UI filter by agent without tying the prompt to a single one. The repository rejects agents from another organization.
- **`prompt_versions`**: `version` 1, 2, 3… per prompt, `content`, detected `variables`, `content_hash` (SHA-256), `parent_version` (what the edit started from), `message`, author. **Immutable**: a trigger rejects any update of the content, variables, hash, number or prompt. Numbering is atomic (the prompt row is locked while inserting).
- **`prompt_tags`** `(prompt_id, tag) -> version_id`: a movable pointer. **`prompt_tag_events`**: append-only history of every move (from, to, who, reason; `to = NULL` means removed).
- Variables use `{{name}}`; they are detected when saving, not validated against any caller yet.

### Environment tags are the organization's environments

A tag whose name is the key of an organization environment (`dev`, `pre`, `pro` by default, ADR-053) is an **environment tag**; any other valid tag is free. The environment list is not duplicated: it is read from `environments`, so a custom environment becomes a promotable tag with no change.

### Permissions (ADR-052)

| Permission | Roles by default | Use |
|---|---|---|
| `prompt:read` | org_admin, technical, business, governance | See prompts, versions, history |
| `prompt:write` | org_admin, technical | Create, save versions, free tags, archive |
| `prompt:promote` | org_admin, technical | Move environment tags |

Authorization on a prompt is **organization permission OR permission in any agent it belongs to**, computed by the route (`requirePromptPermission`). `prompt:promote` is separate from `write` on purpose: phase 4 puts the evaluation gate in front of it, and some organizations will want writers who cannot promote.

### API (ADR-009 style, `/api/v1`)

Agent-scoped list and create (`/experiments/{id}/prompts`), organization-scoped list and create, and by-id endpoints (`/prompts/{id}`, `/versions`, `/versions/{number|tag}`, `/tags/{tag}`). A version resolves **by number or by tag**, which is what the SDK will use. Saving a text identical to the latest version is a `409`: it carries no information.

### What phase 1 deliberately does not do

No gate on promotion, no link with traces, no SDK. Those are the next phases and are decided below only as direction.

## Direction for the following phases (not implemented)

1. **SDK + trace link** *(implemented, see ADR-068; the run does not store its prompts, they are derived from its traces)*. `prompts.get(name, tag=…)` returns a **handle**, not text: agents usually load prompts in their `lifespan`, so the version must be resolved when used (`handle.compile(...)` per request), with a background refresh of the tag (ETag) and the last known version as fallback if the API is down. No network call on the request path; `compile()` is an in-memory lookup and substitution. The SDK stamps `memtrace.prompt.name` / `memtrace.prompt.version` on the current span (ClickHouse materialized columns, same pattern as ADR-065) and reports which version each agent actually uses per environment. Adapters for LangChain / PydanticAI pass a callable instead of baked text.
2. **Evidence per version** *(implemented, see ADR-069)*. Cost, latency, errors by business cause, evaluation scores and feedback aggregated by `(prompt, version)` from the stamped traces; behavioural diff between versions next to the text diff.
3. **Promotion with guarantees.** A per-prompt/environment policy (evaluation dataset, evaluator targets per ADR-060, maximum cost/latency regression, required runs), evaluated by a pure function like `deploy-gate.ts` (ADR-064). Rollback to an already-promoted version needs no new evaluation; an `org_admin` can bypass with a mandatory, audited reason.
4. **Playground against the real assistant.** No LLM provider key in MemTrace for this: the playground calls the agent's own chat endpoint (ADR-055) and overrides the prompt **for that request only** (a signed `baggage` header naming `prompt@version`; the SDK handle honors it only if `MEMTRACE_ALLOW_PROMPT_OVERRIDE` is on, off in PRO by default). The run is a normal trace marked `memtrace.playground=true`. Replaying a trace re-sends its inputs; only against DEV/PRE.
5. **From failure to prompt.** A proposed fix for a failed trace, validated against the failing cases by running the real agent, saved as a `draft` version for human review — never promoted automatically.
6. **Fragments** (`{{> tone@pro}}`), pinned to an exact version at save time so the composed version stays reproducible, and a **dependency map** (prompt ↔ agents, datasets, runs, fragments).

## Consequences

- **Good**: history can never be rewritten; "what ran when" is answerable; the prompt is org-level yet filterable by agent; the permission split is ready for the promotion gate; nothing in phase 1 constrains the SDK design.
- **Cost**: another table family and three permissions; the authorization check loads the prompt to find its agents (fine at this scale).
- **Risk**: the playground/override depends on agents adopting `prompts.get()`; agents with hard-coded prompts get evidence only through CI evaluation. The UI will mark them as not compatible.
- **Names are forever**: renaming is not supported because traces and the SDK reference the name; the workaround is a new prompt.

## Alternatives considered

- **Prompt per agent only** (`experiment_id` on the prompt): simpler but forces duplicating shared prompts and blocks fragments.
- **Mutable prompt + audit log**: cheaper to store, but "what exactly ran" would require replaying the log; immutability makes it a primary key.
- **Server-side playground with a provider key**: standard in other tools, but it does not exercise the agent's tools, RAG or memory, so the result is not the real behavior.
