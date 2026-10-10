# ADR-076: Prompt Approvals (Publish and Promote Behind Rules)

* **Status**: Accepted — backend implemented (2026-10-09); dashboard in the same change set. Amended 2026-10-10: exemptions per experiment
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](../prompts/adr-067-prompt-registry-immutable-versions-and-tags.md), [ADR-070](../prompts/adr-070-prompt-promotion-gate.md), [ADR-072](../prompts/adr-072-drafts-and-fixes-from-failures.md)
* **Related**: [ADR-052](../identity/adr-052-permission-based-roles-and-external-identity-mapping.md), [ADR-064](adr-064-ci-triggered-deployments-with-evaluation-gate.md)

## Context and Problem Statement

Today one person with `prompt:write` publishes a version and one with `prompt:promote` moves `pre` or `pro`. The evaluation gate (ADR-070) checks the *evidence*, but nobody else looks at the change, and the person who defines the gate policy is the one who is gated. Some organizations need a second opinion before a prompt changes — and each one wants a different rule: who must look, how many, and at which stage.

Three requirements drove the design:

1. **Opt-in and configurable.** No organization is forced into approvals; each decides which actions need them and what they need.
2. **Per stage.** Publishing to `dev` may need one technical person; reaching `pre` or `pro` may need a technical *and* a business person.
3. **The organization sets the floor.** An experiment (agent) may ask for more, never for less.

## Decision Outcome

### Two actions, one rule each per stage

| Action | What it is | Stage |
|---|---|---|
| `publish` | A new version is a *pull request*: it is born as a **draft** and becomes a published version only when approved | none |
| `promote` | Pointing an environment tag (`dev`, `pre`, `pro`, …) at a version | the environment key |

A **rule** (`approval_rules`) exists per scope (organization *or* experiment), action and stage. Its existence means the action needs approval. It holds:

- **requirements** — "`min` approvals from people with the profile `role`" (`approval_rule_requirements`; `role` is an experiment role such as `technical` or `business`);
- **default approvers** — named people who must approve *no matter what* (`approval_rule_approvers`).

A rule with neither is not a rule: it is deleted. No rule → the action works exactly as before (ADR-067/070).

### Who may approve what

Publishing is a review of the text, so only the `technical` profile may be asked to approve it (`PUBLISH_APPROVER_ROLES`, one constant). Promotion may ask for any experiment profile, chosen by the organization per stage. Approving requires the new permission `prompt:approve` (granted to `technical` and `business`), *and* holding one of the profiles of the rule or being a named approver. Defining rules requires `approval:manage` (granted to `org_admin`), so the people who are gated cannot rewrite the gate.

### Effective rule: stacking only tightens

A prompt belongs to an organization and to N agents. Its effective rule for an action and stage is the **stack** of the organization's rule and the rules of every agent it belongs to (`mergeRules`): per profile the highest minimum wins and the named approvers are the union. Stacking can only add requirements, so an experiment cannot loosen the organization's floor by construction. On top of that, saving an experiment rule that asks for less than the organization's is refused (`looserThan`, 400), so the mistake is visible instead of silently ignored. If the organization tightens later, existing experiment rules are still stacked correctly.

### Amendment (2026-10-10): exemption per experiment

*Problem.* "The organization sets the floor" deadlocks an organization with agents of different sizes: a rule such as "1 technical approves a publication" can never be met in an agent whose only technical member is the requester (the requester never counts), and an experiment cannot loosen it. The only way out was to remove the organization's rule for everybody.

*Decision.* An **`org_admin` may exempt one experiment from the organization's rule in one step** (publish, or one environment). It is a row in `approval_rule_exemptions (experiment_id, action, stage)` (migration 045), a per-step switch, not a copy of the rule:

- The exempt agent stops following the organization's rule in that step and follows only **its own** rule there (or none). Its own rule is no longer checked against the floor (`setRule`), because the floor does not apply to it.
- The prompt stacking is unchanged except for one pure function (`applicableRules`): the organization's rule is dropped only when **every** agent of the prompt is exempt. If one agent is not exempt, the organization's rule still applies and the strictest wins, as before. A prompt with no agents has nobody to exempt and follows the organization.
- Only `approval:manage` (held by `org_admin`) can grant or revoke it (`PUT/DELETE /experiments/{id}/approval-exemptions`), so the people who are gated still cannot rewrite the gate. Both calls are written to the audit log (`approval_exemption.grant|revoke`, ADR-084).
- It is refused if the organization has no rule in that step (nothing to be exempt from). `GET .../approval-rules` of an experiment also returns its `exemptions`.
- Revoking brings the floor back immediately. A rule the exempt experiment saved while exempt is **not** rewritten, and from then on it is checked against the floor again only when it is saved.

*Alternatives rejected.* Letting any experiment override the organization freely (the organization could guarantee nothing, and the experiment admin could remove their own gate); auto-approving when the requester is the only eligible person (defeats four eyes, already rejected below).

### Requests

`approval_requests` (prompt, action, version, tag, note, requester, status, expiry) with `approval_decisions` (one per person) and `approval_request_approvers` (**extra approvers added on the fly**, required in addition to the rule's). Status: `pending → approved → executed`, or `rejected`, `cancelled`, `expired`. Only one *live* request per target (partial unique index).

Pure function `evaluateApproval` decides, from the effective rule, the people and the decisions:

- the **requester's own approval never counts** (four eyes);
- an approval counts toward every profile of the rule that the person holds; the same person counts once;
- every named approver (rule default **or** added to the request) must have approved;
- one rejection from someone who could decide closes the request;
- the rule is re-evaluated with **today's** rule at every step, so tightening a rule affects requests already open.

### Opening a request is checked up front

`open` refuses to create a request nobody could approve (`unreachableReason`: not enough other people with the profile, or a named approver who is not a member with `prompt:approve`), refuses a rollback (it needs no approval), refuses a promotion the evaluation gate would block (no point collecting approvals for something that cannot happen; the governance bypass of ADR-070 is stored on the request and applied at execution), and refuses an action that needs no approval.

### Execution

Two approvals can arrive at the same instant, so the run is **claimed atomically** (`claimed_at`, a conditional `UPDATE`): only one caller executes the action, the other does nothing. The claim expires after 2 minutes in case the process dies midway and is released if the action fails so it can be retried.

When the last approval arrives the action runs by itself: `publish` publishes the draft; `promote` moves the tag **attributed to the requester**, with the approvers named in the history reason, through the normal `moveTag` — so the evaluation gate is re-checked at that moment. If the gate (or anything else) stops it, the request stays `approved` with `executionError` and the requester can retry (`POST /approvals/{id}/execute`), which re-evaluates the rule first; if the rule was tightened meanwhile it goes back to `pending`.

### Direct paths are closed, not removed

With a rule active: `saveVersion` creates a draft instead of a published version; `publishDraft` and `moveTag` throw `ApprovalRequiredError` (409 with `{action, stage}` so the UI can offer to open a request). **Rollback is exempt**: pointing a tag back at a version it already served needs no approval, the same principle as ADR-070 — in an incident the way back must not be the slowest path. The first version of a new prompt is also a draft under a publish rule.

### API

- Rules: `GET/PUT/DELETE /organizations/{id}/approval-rules` and `/experiments/{id}/approval-rules?action=&stage=` (the experiment GET also returns the organization's floor); both return the options to write a rule (profiles, environments, eligible people).
- Requests: `GET/POST /prompts/{id}/approvals`; `POST /approvals/{id}/decision | execute | cancel | approvers`; `GET /organizations/{id}/approvals` is the inbox of what the caller can still decide.
- `GET /prompts/{id}` carries `approvals: { publish, promote[] }` so screens know what is gated.

## Consequences

- **Good**: each organization defines its own review process per stage with no code change; the floor cannot be loosened; the requester can never self-approve; evidence (ADR-070) and review (this ADR) compose instead of replacing each other; rollback stays fast.
- **Cost**: a draft state shows up on every save for gated prompts; one more screen (rules) and an inbox; the eligibility query joins memberships with role permissions.
- **Risk**: a prompt that belongs to no agent has nobody to approve it (approvers are the members of its agents), so under a rule `open` refuses with an explanation until an agent is linked.
- **Risk**: an approver who leaves the organization can block a request that names them. Mitigation: they stop being eligible, `open` detects it for new requests, and the requester can cancel and reopen; reassigning a named approver of an open request by an admin is not built.
- **Decision**: an approved request is carried out with the permissions it was approved under, not the requester's current ones. If the requester lost `prompt:promote` in between, the promotion still runs (it was reviewed and approved) and the event is recorded under the requester's name; whoever triggers a retry only needs `prompt:write`/`prompt:promote` to call `execute`.

## Not done

A reason or expiry date on an exemption; exemptions at organization level for many agents at once; Email or push notification to approvers (the inbox is pull-based, like annotation queues); approval groups ("any `org_admin`") instead of named people or profiles — it fits the external identity mapping of ADR-052 later; rules for deployments (ADR-064 "approvals in PRO" will reuse the same tables with a new action); approvers' delegation and out-of-office; a separate permission to edit a rule per experiment (today `approval:manage`, held by `org_admin`).

## Alternatives considered

- **Required on or off per organization**: simpler but cannot express "one technical for `dev`, a technical and a business for `pro`".
- **Experiments free to loosen the organization's rule**: more flexible, but then the organization cannot guarantee anything. A per-experiment exemption granted by an `org_admin` (amendment above) keeps the guarantee for everyone else.
- **Approval as a snapshot of the rule at request time**: avoids surprises but lets a request outlive a tightening of the policy; evaluating with today's rule is the safer reading.
- **Auto-approving when the requester is the only eligible person**: avoids deadlocks but defeats four eyes; the up-front check surfaces the problem instead, and a governance bypass remains for the evaluation gate.
