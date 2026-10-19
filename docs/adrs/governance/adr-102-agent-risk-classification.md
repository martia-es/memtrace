# ADR-102: Agent Risk Classification and Risk-Based Requirements

* **Status**: Accepted — classification (data model, API, audit) implemented; risk policy (requirements per level) and dashboard pending
* **Date**: 2026-10-19
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-054](adr-054-experiment-is-an-agent.md), [ADR-076](adr-076-prompt-approvals.md)
* **Related**: [ADR-053](adr-053-assistant-registry-data-model.md), [ADR-064](adr-064-ci-triggered-deployments-with-evaluation-gate.md), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)

## Context and Problem Statement

MemTrace governs agents (registry, evaluation gate, approvals, audit) but treats them all alike. The EU AI Act (Regulation 2024/1689) does not: obligations on risk management (art. 9), documentation (art. 11), log retention (art. 12, art. 26) and human oversight (art. 14) depend on the risk level of the use case. An organization needs to say how risky each agent is and have the stricter requirements follow from that declaration, instead of configuring every control by hand per agent.

Two facts shape the design:

1. **The level depends on the use case, not on behavior.** MemTrace cannot infer it from traces; it is a declaration by a person, and may need legal review.
2. **Whoever is subject to the requirements must not be able to remove them.** The same problem ADR-076 solved for approvals.

## Decision Outcome

### 1. The classification is a declaration on the experiment

Columns on `experiments` (migration 050), because an experiment is an agent (ADR-054) and the classification is the same in every environment:

| Column | Meaning |
|---|---|
| `risk_level` | `minimal`, `limited` or `high`. **NULL = unclassified** |
| `intended_purpose`, `known_limitations` | free text (art. 13); the purpose is required for `high` |
| `risk_classified_by`, `risk_classified_at` | who declared it and when |

- **NULL is not `minimal`.** An agent nobody has reviewed must not look low-risk; the catalog shows it as a warning.
- Prohibited practices (art. 5) are not a level: a prohibited agent is not registered, it is switched off.
- Only the current value is stored. The history is the audit log (`risk.classify`, with `from` and `to`), which already is append-only and retained for a year (ADR-084).

### 2. Permissions

- Classifying needs `governance:manage` (existing; `technical` and `org_admin`).
- **Lowering the level needs `org:manage`** (`org_admin`). First classification and raising are open to `governance:manage`. The rule is a pure function (`isLowering`) checked in `classifyRisk`, answering 403.
- No new permission: the level is part of the governance card, and the lowering rule gives the separation that matters.

### 3. API

`PUT /api/v1/experiments/{id}/risk` with `{ level, intendedPurpose, knownLimitations }`. It is a dedicated endpoint, not a field of `PATCH .../assistant`, because it has its own permission rule and its own audit action. The card (`GET .../assistant`, catalog) returns `risk` as part of `AssistantCardDto`.

### 4. Requirements per level (next step, same ADR)

A per-organization policy, `risk_policies (organization_id, risk_level, require_pro_approval, max_eval_age_days, min_retention_days)`, edited only by `org_admin`. Without a row, domain defaults apply (6 months of retention for `high`, nothing else): the feature is opt-in, like ADR-076. A pure `effectiveRequirements(level, policy)` is consumed by the deploy gate (age of the last evaluation of the SHA), the retention service (refuses to go below the minimum) and, once ADR-064 gets approvals in PRO, the approval rules. The policy is a floor: an experiment may ask for more, never for less.

## Alternatives Considered

- **Infer the level from traces or tools.** Rejected: the level is a property of the use case. A heuristic would give false assurance.
- **A separate table for the classification.** Rejected: it is 1:1 with the experiment and read in every catalog query; ADR-054 already moved the card onto `experiments`.
- **Store the full history in a table.** Rejected: the audit log already records who changed what and when, with the same retention.
- **Let `governance:manage` also lower the level.** Rejected: the team subject to the requirements would remove them with one click.
- **A new permission `risk:classify`.** Rejected for now: it would split the governance card in two without a real separation of duties. Revisit if organizations ask for a compliance role.

## Consequences

- Every agent has a `risk` object; clients must treat `level: null` as "unclassified".
- Legal review of the classification is outside MemTrace: it records the declaration and who made it, not whether it is right.
- The requirements (point 4) will reuse existing gates, so they add no new enforcement point.
