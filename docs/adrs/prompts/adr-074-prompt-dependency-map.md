# ADR-074: Prompt Dependency Map

* **Status**: Accepted — implemented (2026-10-09)
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md), [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md), [ADR-070](adr-070-prompt-promotion-gate.md), [ADR-073](adr-073-reusable-fragments.md)

## Context and Problem Statement

Moving a tag changes what running agents say, but the screen that moves it showed only the gate verdict. Who will actually receive the change was spread over other places: linked agents, usage reports per environment, the policy's dataset, the fragments a prompt includes. Before promoting, a person should see the blast radius in one place.

## Decision Outcome

### A read model built from what already exists, no new tables

`GET /prompts/{id}/map` composes data MemTrace already stores:

- **agents**: the agents linked to the prompt (`prompt_agents`) with what each *reports serving* per environment (usage heartbeat, ADR-068: tag or fixed version, version, last seen);
- **dataset**: the dataset and required runs of the promotion policy (ADR-070), if any;
- **includes** / **usedBy**: the fragments it includes and, for a fragment, the prompts that include it (ADR-073).

Usage of an agent that is no longer linked is not a dependency and is not shown. Usage is as fresh as the heartbeat (ADR-068 forgets what has not been seen for 7 days): the map says what agents *report*, not what is guaranteed to be running.

### Impact before promoting

`GET /prompts/{id}/map?tag=&version=` adds `impact` for that move, computed by a pure function (`promotionImpact`):

- **agents** that follow that tag, with `from → to` and `changes: false` when they already run the target version;
- **pinned**: agents that asked for a fixed version, unaffected;
- **willBeBehind** (fragments only): prompts that include the fragment *through that tag*. Their text does not change (it is pinned, ADR-073); they will show as behind until rebuilt. References by number or by another tag are not listed.

The promotion modal shows it next to the gate verdict. It is information, never a requirement: if it fails to load, promoting still works. The gate (ADR-070) remains the only thing that can block a move.

### Permissions

`prompt:read`, like the rest of the read endpoints. The map exposes agent names of the prompt's own organization only.

## Alternatives Considered

- **Materialize a dependency graph table**: duplicates data that has one source of truth each and needs keeping in sync. Rejected; the queries are small and indexed.
- **Include evaluation runs and traces per version**: already in the Evidence tab (ADR-069); duplicating them here makes the map slow. The map links the structure, Evidence holds the measurements.
- **Block promotion when agents would be affected**: that is the gate's job, with the policy the team chose.

## Consequences

- Cost per call: one usage query, one policy query, one fragment query and one lookup per linked agent. Fine for tens of agents; a prompt linked to hundreds would need a batch lookup.
- The map is only as good as the SDK heartbeat: an agent that does not use `memtrace.prompts` appears linked but "has not reported reading it yet".
