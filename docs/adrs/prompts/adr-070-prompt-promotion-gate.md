# ADR-070: Prompt Promotion Gate

* **Status**: Accepted — implemented (2026-10-08)
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md)
* **Related**: [ADR-064](../governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md), [ADR-060](../README.md#retired-adrs), [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md), [ADR-069](../README.md#retired-adrs)

## Context and Problem Statement

Moving the `pro` tag changes what production says within seconds (ADR-068): it is the most consequential click in the prompt registry, and until now it needed only `prompt:promote`. ADR-064 already solved the same problem for code (a commit deploys only with a passing offline evaluation of that commit). A prompt version needs the same guarantee, with the evaluation tied to the **version**, not to a commit.

## Decision Outcome

### A policy per prompt, opt-in

`prompt_policies(prompt_id, dataset_id, required_runs 1..10)` (migration 034). A prompt **without** a policy behaves as before: nothing is checked. With one, moving a protected environment's tag to a version requires a passing evaluation of **that version** on the policy's dataset. Opt-in keeps existing prompts working and avoids a gate nobody configured blocking everything; the page nudges people to add one.

### Which environments are protected

All the organization's environments **except the first by position** (`dev` by default): `pre` and `pro` are gated, `dev` is where one iterates. No new setting: environments already carry their order (ADR-053), so a custom set (`sandbox, staging, canary, prod`) protects the last three. Removing a tag (`version: null`) and moving free tags are never gated.

### An evaluation "of the version" is found through the traces

There is no prompt column on a run (ADR-068/069). A run of the policy's dataset **belongs to version V** when every one of its items that has a trace used V (the span stamp), and none used another version of the same prompt. A run that mixes versions proves nothing about any of them and is excluded. This is one ClickHouse query (`runsUsingVersion`: `eval_items` → trace → stamped span, last 31 days = trace retention). The consequence is a requirement on the team, documented in the UI: the evaluation must run with the agent reading the prompt through `memtrace.prompts`.

### The criterion is the one the deploy gate already has

A run passes when it has at least one boolean evaluator and every boolean evaluator reaches its target pass rate (ADR-060: the score config's `target_pass_rate`, 80 % by default); an evaluator that scored only part of the items (the rest failed to run) fails the run. The pure function `judgeRun` and the failure sentence (`describeFailure`) are shared with ADR-064, so there is one definition of "passes". `required_runs` (default 1, configurable up to 10) is how many of the **latest** completed runs must pass: a later failure blocks, a later pass unblocks. A single pass of a non-deterministic LLM is an indication, not proof; whoever wants more rigor raises the number.

`evaluatePromptGate` is a pure function with verdicts `not_gated`, `no_policy`, `rollback`, `policy_incomplete`, `no_evaluation`, `evaluation_running`, `failed`, `insufficient_runs` and `allowed`. The service gathers the runs, the aggregates and the score-config targets; the function decides.

### Rollback needs no new evaluation

Pointing a tag back to a version it **already had** — without anyone skipping the gate — is a rollback and is allowed (`prompt_tag_events.to_version`, `gate_bypassed = false`). In an incident, the way back must never be the slowest path. A move that was a **bypass** does not count: going back to a version that only reached `pro` by skipping the evaluation is promoting it again. The history before this migration has no verdict and counts as served.

### Skipping the gate

A bypass needs `governance:manage` (org-level, like ADR-064) **and** a reason of 5–500 characters. The event stores `gate_verdict` (what the gate said), `gate_bypassed` and `bypass_reason`, and the history shows "skipped the evaluation: …". A technical user without governance who sends a bypass reason gets the same `409`.

### Who can do what

| Action | Permission |
|---|---|
| See the policy and the gate verdict | `prompt:read` |
| Create, change or remove the policy | `prompt:promote` |
| Move a protected environment (gate passes) | `prompt:promote` |
| Skip the gate | `prompt:promote` + `governance:manage`, with a reason |

Defining the policy is open to whoever can promote. This is the same trust model as owning the CI workflow of ADR-064: the owner of the agent defines how it is checked, and **every change of policy and every bypass is visible**. A stronger separation (policy edited only by governance) would be a new permission; it is easy to add on top of this and is left until someone asks.

### A policy that loses its dataset blocks

If the dataset is deleted the FK sets it to `NULL` and the verdict becomes `policy_incomplete`: promotions are blocked and the page says why. A gate must not open because a row disappeared. The dataset has to belong to one of the prompt's agents.

### API

`GET/PUT/DELETE /prompts/{id}/policy`; `GET /prompts/{id}/gate?tag=&version=` (preview, read-only: what the page shows before «Move»); `PUT /prompts/{id}/tags/{tag}` accepts `bypassReason` and answers `409` with the verdict when blocked. The prompt detail carries `policy` and `gatedEnvironments`.

## Consequences

- **Good**: reaching `pre`/`pro` is backed by a measured evaluation of that exact version, with one shared definition of "passes"; emergencies have an audited exit; rollbacks are instant; the page explains every refusal.
- **Cost**: teams must run the evaluation with the agent reading `memtrace.prompts`; runs older than the trace retention (30 days) no longer count. The attribution query joins `eval_items` with the stamped spans.
- **Risk**: the criterion only knows boolean evaluators; a prompt evaluated only with numeric ones cannot pass. This mirrors the deploy gate and is a deliberate limit for now.

## Not in this phase

Cost and latency regression limits in the policy (they come from production traces, not from the offline evaluation chosen here), a separate permission to edit the policy, per-environment policies, and requiring approval by a second person.

## Alternatives considered

- **Policy per environment**: more flexible, more UI; the rule "all but the first environment" covers the case without configuration.
- **Gate on by default for every prompt**: safer on paper, but blocks every existing prompt until configured.
- **Store the prompt version on the run**: a second source of truth that the SDK would have to keep consistent; the stamped traces already say it.
