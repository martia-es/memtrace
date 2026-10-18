# ADR-101: LLM Provider Keys Held by MemTrace, Sealed for a Single Worker

* **Status**: Accepted — not implemented
* **Date**: 2026-10-18
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md), [ADR-087](adr-087-multi-tenant-security-baseline.md), [ADR-090](adr-090-network-segmentation-and-collector-access.md), [ADR-091](adr-091-client-boundary-for-multi-client-organizations.md), [ADR-093](adr-093-audit-of-consultancy-access.md), [ADR-100](../storage/adr-100-arcadedb-knowledge-store.md), [phase 2 design](../../archive/phase_2_design.md)

## Context and Problem Statement

Until now MemTrace held **no** provider keys. Every call to a model (LLM judges, `prompts.propose_fix`) runs in the user's own process with the user's own key, so MemTrace never saw a key and nothing left the installation through it.

Phase 2 (Mem) breaks that equilibrium in a way the user notices. Writing a lesson from a group of failures needs an LLM ([phase 2 design](../../archive/phase_2_design.md), step 8). If the user must run a command on their machine to get each lesson, the loop stops being automatic: nobody remembers to run it, and the dashboard cannot offer a "write the lesson" button. The experience we want is the opposite: the user pastes a key once in Settings and lessons appear by themselves.

That makes MemTrace the custodian of a credential that costs money and, if misused, can leak data or run up a bill. It is a **new security boundary**, hard to undo once users have entered keys, and it touches the API, the database, a worker, the network policy and the audit log. It is also an item that [security-pending.md](../../security-pending.md) already lists under "Flujos hacia terceros".

## Decision Drivers

1. One-time setup by the user; no recurring manual step.
2. A compromise of the API or the dashboard must not reveal stored keys.
3. A leaked database dump or backup must not reveal them either.
4. Content leaving the installation must be minimal, visible and switchable.
5. Spend must be bounded per organization.
6. It must work for self-installed open-source deployments with no external key manager.

## Considered Options

| Option | Verdict |
|---|---|
| **A. The user pastes the key in Settings; MemTrace stores it sealed and uses it from one worker** | **Chosen** |
| B. The user runs the distillation command or a CI job with their own key (status quo) | Rejected as the default: it needs a recurring manual step and cannot power a button. Stays available as an alternative for those who refuse to give MemTrace a key |
| C. Store only a *reference* to a key kept in the installer's secret manager (a Kubernetes Secret, Vault, a cloud KMS) | Not rejected, but not the first step: it needs an integration per manager. It is the natural second mode for self-hosted installs and does not conflict with this ADR |
| D. Store the key in plain text or reversibly encrypted with a key that the API also holds | Rejected: a compromised API would read every key |

## Decision Outcome

### 1. The key is sealed to the worker, so the API cannot read it back

The Mem worker owns a key pair. The **public** key is available to the API; the **private** key is mounted only in the worker's pod. When the user saves a key, the API encrypts it with the public key (a sealed box: X25519 for the key exchange and an authenticated cipher for the data) and stores only the ciphertext in PostgreSQL. The API and the dashboard can write and delete a key but can never decrypt one.

- A database dump or backup holds ciphertext only. The private key lives in a Kubernetes Secret that the backup job does not read ([ADR-096](../infra/adr-096-production-operations-backups-helm-load-gates.md)).
- The key is **write-only** in the product: after saving, the interface shows the provider, the last four characters and the date, never the value. Rotating means pasting a new one.
- Keys belong to an **organization**, and for consultancies to a client ([ADR-091](adr-091-client-boundary-for-multi-client-organizations.md)); one organization's key is never used for another's data.

### 2. Who can manage it and who sees what

- New permission `provider_key:manage`, given to `org_admin` and not to `technical` or `business`. Saving, rotating and deleting a key are recorded in the audit log ([ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)), with who and when but never the value.
- Every use is also recorded as a count (calls, tokens, estimated cost) per run, readable with `audit:read`.
- The feature is **off by default** per organization. Turning it on is an explicit action that shows what will be sent (section 3).

### 3. What leaves the installation

Only the minimum needed to write one lesson, through a single code path (`mem` worker):

- the rule that was found, counts and trend, a handful of example goals that failed and succeeded, the step and error text;
- content already masked by the SDK and the Collector ([ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)), truncated and capped at a fixed number of examples;
- never full traces, user identifiers or keys of other systems.

The Settings screen has a **preview** that renders the exact request for a sample finding, so the user can see what a call contains before enabling the feature. A per-organization switch turns the flow off again; stopping does not delete lessons already written.

### 4. Spend is bounded

A monthly spend limit and a cap on tokens per run per organization, enforced by the worker before each call. Reaching the limit pauses distillation and raises an in-app notification ([ADR-094](../observability/adr-094-in-app-notification-feed.md)); it never fails silently. The existing budget alerts ([ADR-086](../observability/adr-086-alerts-and-cost-budgets.md)) can watch the same figure.

### 5. Network and logging

- The worker is the only pod allowed egress to a provider, and only to the host configured for the organization (network policy, [ADR-090](adr-090-network-segmentation-and-collector-access.md)).
- Keys, requests and responses are never written to logs. Error messages from providers are stored truncated and with the key redacted.
- Output of the model is parsed as structured data and validated (length, fields, no instructions addressed to the pipeline); a lesson is only text proposed to a human, never executed ([phase 2 design](../../archive/phase_2_design.md), section 8).

## Consequences

**Positive**
- The loop is automatic after a one-time setup, and the dashboard can offer "write the lesson" and "create a draft" buttons.
- A breach of the API, the dashboard or a database backup does not expose keys; only the worker's pod can decrypt.
- Cost and data flow are bounded, visible and auditable.

**Negative / risks**
- MemTrace now stores credentials. The worker and its private key become the most sensitive component, and rotation of that key pair needs a procedure (re-seal on rotation).
- A compromised worker pod exposes the keys of every organization it serves. Mitigated by egress limits, a minimal image and running only this job in the pod.
- An implementation of the sealed box in the API (TypeScript) must be reviewed; use a maintained library, not a hand-rolled scheme.
- Users of the status-quo option still need B; both modes must remain supported.

## Verification (before it ships)

| Check | Pass criterion |
|---|---|
| API cannot decrypt | A test that gives the API's credentials and the database access to an attacker confirms no key can be recovered |
| Backup safety | A restored backup contains no plaintext key |
| Redaction | Keys appear in no log line, error message or audit entry; verified with a search over test output |
| Egress | A pod other than the worker, and a host other than the configured one, are blocked |
| Limits | A run stops at the token cap and at the monthly limit, and notifies |
| Preview matches reality | The previewed request equals the request actually sent for the same finding |
| Isolation | One organization's key is not used for another's data |

## Rollout

1. The sealed-key store, permission, audit and Settings screen (with an interface proposal first, as the project requires for important UI changes).
2. The worker path with limits, preview and network policy.
3. The distillation step of phase 2.2 on top.
4. Mode C (a reference to the installer's secret manager) when a self-hosted user asks for it.
