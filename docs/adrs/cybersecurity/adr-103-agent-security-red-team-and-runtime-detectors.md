# ADR-103: Agent Security — Offline Red Team Runs and Deterministic Runtime Detectors

* **Status**: Accepted — not implemented
* **Date**: 2026-10-25
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-028](../evaluation/adr-028-offline-evaluation-decoupled-sdk.md)
* **Related**: [ADR-044](../evaluation/adr-044-eval-items-and-scores-tables-telemetry-from-traces.md), [ADR-064](../governance/adr-064-ci-triggered-deployments-with-evaluation-gate.md), [ADR-087](adr-087-multi-tenant-security-baseline.md), [ADR-095](../sdk/adr-095-multi-language-sdk-contract.md), [ADR-102](../governance/adr-102-agent-risk-classification.md), [spike](../../../spikes/redteam/README.md)

## Context and Problem Statement

ADR-087 to ADR-093 protect **MemTrace** (tenants, ingestion, network). Nothing protects or measures the **agents** MemTrace observes: whether an agent resists prompt injection, leaks its system prompt, secrets or personal data, or calls a tool it should not. Agents are the main attack surface of the people who use MemTrace.

Two constraints from earlier decisions shape the answer:

- **Online evaluation was discarded** (backlog, 2026-10-10). MemTrace does not run LLM judges over production traces, and does not read trace content to classify it.
- **MemTrace never calls the agent** (ADR-028). Offline work runs in the user's process with the user's keys.

## Decision Drivers

1. Reuse maintained libraries; do not write detection rules that we could get wrong.
2. No latency worth noticing on the agent's request path; no network calls.
3. Same contract in every SDK language (ADR-095).
4. Never copy the sensitive text that was detected into a trace.
5. The developer decides in code whether to continue; MemTrace only reports.

## Considered Options

| Option | Verdict |
|---|---|
| **A. Two parts: red team as an offline run (client side) + deterministic detectors in the agent that emit spans** | **Chosen** |
| B. MemTrace calls the agent with attacks from a worker | Rejected: new network and secrets boundary; breaks ADR-028 |
| C. MemTrace scans stored traces in the background | Rejected: it is the discarded online evaluation, and MemTrace would read every trace's content |
| D. ML classifiers for prompt injection in the request path | Rejected for now: tens of ms and heavy dependencies, not deterministic |

## Decision Outcome

### 1. Red team is a normal evaluation run

A red team run is a `dataset_run` (ADR-028, ADR-044) executed with `run_experiment`. It adds only metadata, no new store:

- `run_kind = "redteam"` on the run, and `category` on each item (taxonomy below).
- Judges are ordinary evaluators (`Score(source=...)`): `InjectionResisted`, `SystemPromptNotRevealed` and `NoSecretLeak` are LLM judges (ADR-029); `NoUnauthorizedTool` is deterministic and uses the tool policy of section 3.
- Seed datasets per category ship with the SDK, mapped to the OWASP Top 10 for LLM Applications. Users add their own.
- The headline metric is the **attack success rate (ASR)** per category, derived from the scores. Comparison, noise measurement (ADR-097) and the eval gate keep working unchanged.

### 2. Runtime detectors emit spans, deterministically

Detectors run **inside the agent**, on the input, the output, retrieved chunks or tool results, and record one span `security.<detector>` (`memtrace.step_type`, same mechanism as custom steps). No detector makes a network call. Attributes:

| Attribute | Value |
|---|---|
| `security.detected` | boolean |
| `security.category` | taxonomy value |
| `security.severity` | `info` / `warn` / `error` |
| `security.action` | `observed` / `warned` / `blocked` |
| `security.score` | optional number (e.g. overlap ratio) |

**The matched text is never recorded**, only the category, severity and score. MemTrace stores and charts these spans like any other (custom charts, "Needs attention", alerts of phase 1.95). It does not interpret content.

Detectors wrap existing libraries (spike results in [spikes/redteam](../../../spikes/redteam/README.md)):

| Detector | Backed by | Notes |
|---|---|---|
| `secret_leak` | detect-secrets, **prefix and format plugins only** | Its default entropy plugins flag plain English; do not enable them |
| `pii_leak` | Presidio predefined recognizers called directly | Card (Luhn), IBAN, email, national id. Works without loading spaCy. Names remain the opt-in PII layer of ADR-021 |
| `system_prompt_leak` | word 3-gram overlap with the system prompt, normalized | Optional canary token in the prompt. Copies and light edits only |
| `tool_policy` | the agent's own declared policy | Section 3 |

### 3. `tool_policy`: the developer decides whether to continue

```python
policy = ToolPolicy(allowed_tools={...}, rules={"read_file": {"path": under("/srv/data")}}, mode="enforce")
verdict = policy.check("read_file", {"path": p})   # .ok / .warn / .error
@policy.guard                                       # raises ToolPolicyViolation on error
```

- Each rule declares `warn` or `error`. `mode` is `observe` (record only), `warn` (record and log) or `enforce` (raise `ToolPolicyViolation` on `error`). Adopting it starts in `observe`.
- Every decision is recorded as `security.tool_policy` with `action` `observed`/`warned`/`blocked`, whichever the mode.
- Framework integrations (LangGraph, OpenAI Agents SDK, LangChain) hook where tools are already instrumented, so the developer does not wrap each tool.
- Without a declared policy nothing is checked.

Other detectors return the same `Verdict` so the developer can also stop on a leak in the output; none blocks by itself.

### 4. Categories

`prompt_injection`, `indirect_injection`, `jailbreak`, `system_prompt_leak`, `secret_leak`, `pii_leak`, `unauthorized_tool`, `harmful_content`. Detectors and judges use these values; new ones are added by extending this list.

### 5. What is deliberately not covered

- **Prompt injection has no production detector.** No maintained deterministic option is reliable: a preprint measures at most 13 % detection for the default heuristics of Rebuff and Vigil on three of four datasets. We do not ship hand-written rules and we do not present a zero as safety. Injection is **measured** by the red team run. An optional adapter for an external detector is left for later.
- **Paraphrased or translated prompt leaks.** In the spike a paraphrase scores like unrelated text. Only the offline LLM judge measures them.
- **Harmful or toxic content** in production (no reliable deterministic method).

### 6. Out of this ADR

A security requirement in the deploy gate (ADR-064) and a security posture screen are consequences of this contract, not part of it. The screen reads only the query API; the gate is recorded in the [backlog](../../backlog.md) and may extend ADR-064 later.

## Consequences

- **Positive**: no new store; red team reuses runs, comparison, noise and the gate; detector rules come from maintained libraries; no content duplicated in traces; the agent stays in control.
- **Negative**: no data for agents that do not install the detectors; a detector can only report what its library knows; ASR depends on the quality of the attack set and the judge.
- **Cost**: detectors measured at ~0.5 ms (secrets), ~0.05 ms (PII) and ~0.01 ms (leak) per call in the spike. The SDK carries a benchmark and CI fails if a detector exceeds its budget.
- Must stay identical in the Python and TypeScript SDKs through the shared conformance scenarios (ADR-095).

## Pending

Attack seed sets and judges; `memtrace.security` detectors and `ToolPolicy` (Python, then TypeScript); canary token; detector benchmark in CI; dashboard posture screen (UI proposal first); user documentation in `docs-site/`.
