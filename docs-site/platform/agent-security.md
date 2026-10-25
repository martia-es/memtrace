# Agent security

The **Security** screen of an agent shows two things side by side: what the agent's own detectors found while it was serving real conversations, and how it held up against the last attack sets you ran against it. Everything on it comes from data your agent already sends. MemTrace reads and counts it; it never calls your agent and never shows the text that was detected.

You add the detectors and run the attacks from your code, with the [`memtrace.security` and `memtrace.redteam` modules of the library](/library/security). This page explains what you see once they do.

## Who sees it

The **Security** entry appears in the **Watch** group of the menu for people with the `assistant:manage` permission on the agent (the `technical` profile) or `governance:read` in its organization. Everyone else does not see it, and the API answers `403`.

## What the screen shows

- **Period.** 7, 30 or 90 days. The choice is kept in the address (`?days=`).
- **Three cards.** *Detections* found in the period, how many of them were *Blocked* (the agent stopped), and the *Attack success rate* of the latest red team run.
- **Detections per day.** One bar per day (UTC). Under it, the count by action (*observed*, *warned*, *blocked*) and two tables: by detector and by category.
- **Red team runs.** The 10 most recent completed runs, with their commit, how many attacks they made, how many got through, the **attack success rate (ASR)** and the ASR of every category. A run name opens the usual run page, where you can read each item.

A new agent starts with both parts empty. The empty states tell you what to add; they do not mean the agent is safe.

## Detections in production

When a detector of the library finds something, it records a short step called `security.<detector>` in the trace, with a category, a severity and what the agent did about it. The screen counts those steps.

| Detector | Finds |
|---|---|
| `secret_leak` | API keys, tokens and private keys in the agent's reply |
| `pii_leak` | Personal data with a fixed format (card, IBAN, email, national id) in the reply |
| `system_prompt_leak` | The reply repeating parts of the agent's own system prompt |
| `tool_policy` | A tool call the agent was not allowed to make, by the policy you declared |

Each detection has an **action**: *observed* (only recorded), *warned* (recorded and logged) or *blocked* (the agent stopped). Whether the agent stops is decided by your code, not by MemTrace.

The detected text is never stored, only the category, severity and a score. Because the steps are normal spans, they also appear in the trace and can be charted and alerted on like any other step.

## Red team runs

A red team run is a normal [offline evaluation run](/platform/evaluation) whose name starts with `redteam/`. Each item is one attack with a category (for example `prompt_injection`, `jailbreak` or `secret_leak`). The scores say whether the agent resisted. An attack **got through** when any of the item's pass/fail scores is `false`.

The **attack success rate** is the attacks that got through divided by the attacks evaluated. **Lower is better**: 0 % is green, up to 10 % is a warning, more is an error. Items whose task failed to run are not counted and are listed under the run name.

## What it does not tell you

- **Prompt injection has no production detector.** No maintained detector is reliable enough to be useful, so MemTrace does not pretend to have one. Injection is measured by red team runs before you deploy.
- **A reworded leak of the system prompt is not detected in production.** The detector finds copies and light edits. A paraphrase or a translation only shows up in a red team run judged by a model.
- **Zero detections is not proof of safety.** It means your detectors found nothing. An agent without detectors also shows zero.
- **Detections are counted per agent.** If you run attacks against a copy of the agent that sends traces to the same agent in MemTrace, they are counted as detections too. Use a separate agent for attack sessions, or accept them in the numbers.

## API

`GET /api/v1/experiments/{experimentId}/assistant/security?days=30`. See [Query API](/platform/api).
