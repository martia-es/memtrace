# ADR-073: Reusable Fragments

* **Status**: Accepted — implemented (2026-10-09)
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md)
* **Related**: [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md), [ADR-070](adr-070-prompt-promotion-gate.md), [ADR-072](adr-072-drafts-and-fixes-from-failures.md)

## Context and Problem Statement

Several prompts repeat the same text (tone, safety policy, output format). Copying it means fixing a policy in ten places; sharing it live means a change to one text silently changes ten production agents, with no gate and no way to reproduce what an old trace saw.

## Decision Outcome

### A fragment is a prompt of another kind

`prompts.kind` is `prompt` or `fragment` (migration 037). A fragment has versions, tags, history and a promotion policy exactly like a prompt, and is simply not deployed to an agent. No second registry.

### Include syntax: `{{> name@ref}}`

`ref` is **mandatory**: a tag (`pro`) or a version number (`3`). A bare `{{> tone}}` is rejected: a reference that silently means "whatever is newest" is the failure we are avoiding. Anything that starts with `{{>` and is not a well-formed include is a validation error, so it can never reach the model verbatim.

### Includes are resolved and pinned when saving, never at runtime

Saving a version resolves each include to a **published** version of the fragment and stores:

- `content`: the resolved text. This is what the SDK serves, what is hashed, evaluated and traced. **The SDK, the resolve endpoint and the compile path do not change**, and serving costs nothing extra.
- `source`: what the author wrote, with the includes (NULL when there are none).
- `includes`: `[{name, ref, version}]`, the exact fragment versions used.

All three are immutable (the trigger of 036 now guards them). Consequence: a version always means one text. Editing a fragment never changes an existing version of a prompt, so evidence (ADR-069) and gate verdicts (ADR-070) stay true.

Rules: fragments cannot include fragments (no cycles, no depth to reason about); only published versions can be included (not drafts); archived fragments cannot be included; at most 20 different includes per version; the fragment's `{{variables}}` become variables of the prompt.

### A fragment change reaches prompts as a draft

The detail of a prompt compares each tag reference with where the tag points today (`outdated`); a reference by number never goes out of date. `POST /prompts/{id}/rebuild` re-resolves the latest published **source** and saves a **draft** (ADR-072) — 409 if nothing changed or nothing is included. `POST /prompts/{fragmentId}/rebuild-dependents` does it for every dependent that is behind, only for those the caller can write (`prompt:write` is checked per prompt); the rest come back as `skipped`. Nothing is published or promoted automatically: a person reviews the draft, tests it (ADR-071), and publishes.

### "Used by"

A fragment lists the prompts whose **latest published** version includes it (GIN index on `includes`), and which are behind. Older versions do not count: they are history, not dependencies.

## Alternatives Considered

- **Resolve at serve time**: smallest storage, but a fragment edit changes production without a gate and old traces cannot be reproduced. Rejected.
- **Auto-publish the rebuild**: removes a click, but turns one edit into N unreviewed production changes. Rejected; drafts exist for this.
- **Implicit latest (`{{> tone}}`)**: rejected, see above.
- **Nested fragments**: useful, but needs cycle detection and a bounded depth. Deferred until someone needs it.

## Consequences

- Storage: the text of a fragment is duplicated into each version that includes it. Prompts are small; reproducibility is worth it.
- Editing a prompt that has includes starts from `source`; the UI and API must never prefill the editor with `content`, or the includes would be lost.
- The dependency map (next phase) builds on `includes` and `usedBy`.
