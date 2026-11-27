# ADR-104: Mem Lessons — Data Model, States and Permissions

* **Status**: Accepted — data model, permissions and state machine implemented (2026-11-27); repository, endpoints and screens pending (phase 2.2)
* **Date**: 2026-11-27
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md), [ADR-067](../prompts/adr-067-prompt-registry-immutable-versions-and-tags.md), [ADR-072](../prompts/adr-072-drafts-and-fixes-from-failures.md), [ADR-076](adr-076-prompt-approvals.md), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-091](../cybersecurity/adr-091-client-boundary-for-multi-client-organizations.md), [ADR-100](../storage/adr-100-arcadedb-knowledge-store.md), [ADR-101](../cybersecurity/adr-101-provider-keys-held-by-memtrace.md), [phase 2 design](../../archive/phase_2_design.md)

## Context and Problem Statement

Phase 2.1 finds rules that explain recurring failures of an agent (`mem_findings`, in ClickHouse). Phase 2.2 turns a finding into a **lesson**: a short instruction the agent receives when the situation in which it used to fail happens again (phase 2.3). The phase 2 design settled that *what is computed from traces lives in ClickHouse and what a person decides lives in Postgres* and that **Mem proposes and a person decides, always**. Before building the repository, the API and the *Learning* screen, the shape of a lesson, its states and who may move it have to be fixed, because the SDK (`{{lessons}}`, trace stamp) and the measurement of phase 2.4 depend on them.

## Decision Outcome

### Postgres, five tables, no new store

| Table | Holds |
|---|---|
| `lessons` | One row per lesson: experiment, `status`, `source` (`mem` or `manual`), `fingerprint`, `current_version`, `origin_metrics` |
| `lesson_versions` | The text. Each edit is a new immutable version (a trigger forbids updating the content columns) |
| `lesson_evidence` | Trace ids only, `failure` or `success`. Never trace content; they may dangle once the trace expires (ADR-084) |
| `lesson_activations` | Which approved version is served in which environment |
| `lesson_events` | Append-only history: who did what and when (`NULL` actor = the Mem worker) |

A lesson belongs to **one experiment** (an experiment is an agent, ADR-054). An agency never learns from one client to apply it to another (ADR-091), so there is no organization-wide lesson.

### The text is split by who reads it

`title`, `situation` and `failure` are context **for the reviewer** and are never injected. `guidance` (at most 500 characters) is the **only** text the agent receives, bounded because it is added to every matching request. Keeping the injected text short and separate is what makes the token budget of phase 2.3 enforceable.

### When it fires is deterministic

`match` lists tools, error categories or intents, and **at least one** is required: a lesson with no trigger would apply to everything. Matching uses names the agent already emits, with no embeddings per request, so serving a lesson costs a dictionary lookup.

### States and who may move them

```
proposed ──► reviewed ──► approved ──► obsolete / retired
   │            │  ▲          │
   ▼            ▼  │ (changes)│
dismissed ◄─────┘  └─ proposed
```

- `proposed → reviewed`, `dismissed`, and sending it back to `proposed` need `lesson:review`.
- `reviewed → approved`, retiring and declaring obsolete need `lesson:approve`. **Nothing reaches `approved` without passing `reviewed`.**
- A dismissed lesson keeps its `fingerprint`, so Mem does not propose it again; a reviewer can reopen it. `retired` is final.
- Editing the text creates a new version and returns the lesson to `proposed`, and its activations are removed: an unapproved text never reaches the agent.
- `obsolete` is for lessons invalidated by a model or prompt change or that stopped firing.

The transition table lives in the domain (`api/src/domain/lesson.ts`, `LESSON_TRANSITIONS`) so a route cannot allow what the table forbids.

### Permissions, with the logic of `prompt:read|write|promote`

| Permission | Allows | Roles |
|---|---|---|
| `lesson:read` | See lessons, evidence and history | `org_admin`, `technical`, `business`, `governance` |
| `lesson:review` | Propose by hand, edit, mark reviewed, send back, dismiss | `org_admin`, `technical`, `business` |
| `lesson:approve` | Approve, activate per environment, retire, mark obsolete | `org_admin`, `technical` |

`business` reviews but does not approve: they know whether the lesson is true, but putting an instruction in the agent is a technical decision (same split as the annotation queues). The permissions are data in `role_permissions` (migration 054) and mirrored in `BUILT_IN_ROLES`, so a test fails if the documentation drifts.

### One fingerprint per finding

`fingerprint = hash(experiment, findingId)`, unique per experiment for `source = 'mem'` (`NULL` for manual lessons, enforced by a check). Discovery passes are repeated daily; the fingerprint makes proposing idempotent and makes *dismissed* durable.

### Two ways to write the lesson, one model

The text is produced either by the user's own LLM from the SDK (`memtrace.mem.distill`, no key held by MemTrace) or, later, by the Mem worker with the sealed key of ADR-101. Both write the same `lesson_versions` row with `origin = 'mem'`; a person's edit is `origin = 'human'`. The model does not depend on who calls the LLM.

## Alternatives Considered

* **Lessons in ClickHouse next to the findings.** Rejected: they are decisions with state, approvals and an audit trail, not derived data; ClickHouse would need mutable rows and transactions it does not offer. Losing ClickHouse must not lose a human decision.
* **Lessons as prompt versions (ADR-067).** Rejected: a lesson is applied per situation, from several sources, without replacing the whole prompt, and it has its own lifecycle (obsolescence). Reusing the prompt registry would force one text per environment. The *fix* flow of ADR-072 stays as the way to change the prompt itself.
* **Mutable lesson text with an edit log.** Rejected: the trace stamps `lesson id + version` and the effect of a lesson is measured per version (phase 2.4); a mutable text would silently change what old traces mean.
* **Organization-level lessons.** Rejected for the client boundary (ADR-091).
* **ArcadeDB as the lesson store.** Rejected: it is reserved for the relations graph (ADR-100, deferred); lessons need relational integrity and the existing backups.

## Consequences

* **Good**: no new store; every change has an actor and a version; an unapproved or edited text can never be served; the injected text is bounded.
* **Cost**: five tables and a trigger to maintain; activations must be cleaned in the repository when a lesson leaves `approved` or its text changes (documented in the migration, to be covered by repository tests).
* **Pending**: `LessonRepository` and endpoints, the SDK call that saves a lesson, the *Learning* screen (UI proposal first), and the shape of `memtrace.lessons.get` / `{{lessons}}`, which gets its own SDK ADR before phase 2.3.
