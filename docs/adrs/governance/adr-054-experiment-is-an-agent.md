# ADR-054: An Experiment Is an Agent

* **Status**: Accepted
* **Date**: 2026-10-05
* **Deciders**: MemTrace Core Team
* **Amends**: [ADR-053](adr-053-assistant-registry-data-model.md) (the `assistants` table and the registration step)

## Context and Problem Statement

ADR-053 kept the assistant's card in its own table, `assistants`, 1:1 with the experiment, and added an explicit *Register assistant* step. In practice that meant an organization could have three experiments and an empty catalog: the experiment was already "the traces and dashboard of one agent" (roadmap, phase 1), but the governance view only knew about the ones somebody remembered to register. Two ways of saying "this is an agent" is one too many.

## Decision Outcome

**An experiment is an agent.** There is no separate registration: creating an experiment is creating the agent, and the catalog is the list of the organization's experiments.

### Data model (migration `024_experiment_is_agent.sql`)

- The card moves onto `experiments`: `description`, `owner_user_id`, `lifecycle` (`active` | `retired`) and `updated_at`. The name is the experiment's name and the creation date is `created_at`.
- `assistants` is dropped. Its rows are copied to the experiment first, and the foreign keys of `assistant_deployments`, `assistant_connections.experiment_id` and `assistant_connections.peer_experiment_id` are recreated against `experiments(id)` (cascade on delete, `SET NULL` for the peer).
- Existing experiments are backfilled: the owner is whoever joined first as `technical`, which is the person who created it (creating an experiment adds its creator as `technical`, ADR-052).
- The deployment, health, connection and access tables keep their names: *assistant* stays the governance word for what an agent looks like deployed.

### Creation

`POST /organizations/{id}/experiments` accepts `description` (optional) and sets the creator as owner, in the same insert. The creation form in Settings asks for them. There is no `POST …/assistant` any more; `GET` and `PATCH …/assistant` work for every experiment and `GET` never returns "not registered".

### Consequences for the registry

- The catalog lists every experiment of the organization; one without environments shows as *Not deployed*.
- A connection to another agent (`peer_experiment_id`) can point to any experiment of the **same organization**; the repository checks it, because a foreign key alone would accept an experiment of another organization. Before, the target had to be a registered assistant.
- The health worker reads `lifecycle` from `experiments` (a retired agent stops being probed).
- No permission changes: `assistant:manage` still belongs to `technical` and `governance:*` to `org_admin` and `governance`.

### Amendment: no `team`

The first version also had a free-text `team`. It grouped nobody and granted nothing, so it was dropped (migration `025_drop_experiment_team.sql`). Who is part of an agent is the list of members of its experiment, chosen by hand with the `technical` or `business` role; the catalog card shows their profile photos and the card page links to the members tab for whoever has `member:manage`.

## Consequences

- **Positive**: one concept, no orphan experiments in the governance view, and one fewer step for whoever creates an agent.
- **Positive**: the owner is known from the start instead of being filled in later.
- **Negative**: `experiments` grows four columns that tracing does not care about; accepted because it is still one small row per agent.
- **Negative**: the word *experiment* stays in the API, the code and most of the interface for the agent. Renaming it everywhere is a separate, much larger change that this ADR does not take on.
