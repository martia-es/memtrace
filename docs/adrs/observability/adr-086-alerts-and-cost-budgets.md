# ADR-086: Alerts and Cost Budgets

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-053](../governance/adr-053-assistant-registry-data-model.md) (the CronJob worker pattern), [ADR-062](adr-062-end-user-feedback-on-traces.md), [ADR-027](../README.md#retired-adrs), [ADR-084](../storage/adr-084-data-protection-retention-masking-audit-and-export.md)

## Context and Problem Statement

MemTrace was a viewer: a spike in errors, a slow model or a runaway bill was only noticed by someone who happened to open the dashboard. Items F1 and F2 of `docs/backlog.md` ask for threshold alerts with notifications, and for per-agent cost budgets. The metrics already exist (Overview, feedback, saved custom charts), so the problem is evaluation, state and delivery, not measurement.

## Decision Outcome

### 1. Rules, evaluated every five minutes by a CronJob

A rule belongs to one experiment and says: *metric*, *above/below*, *threshold*, *window*, *minimum samples*, *reminder*, *recipients*.

| Metric | Value over the window | Unit of the threshold |
|---|---|---|
| `error_rate` | failed traces / traces | % |
| `latency_p95` | p95 of trace latency | ms |
| `cost` | estimated spend in the window | USD |
| `satisfaction` | 👍 / (👍 + 👎) | % |
| `custom` | the number of a saved custom chart (ADR-027) | the chart's own |

A `custom` rule must point to a saved chart with **one** step type and **no** group-by, because an alert needs a single number. A CronJob (`alerts-evaluate`, every five minutes, same image as the API) loads the enabled rules, computes each value with the services the dashboard already uses, and applies a pure state machine (`domain/alert.ts`).

### 2. State machine

States are `ok`, `firing` and `no_data`. A rule fires only if the window has at least `minSamples` observations (traces for error rate and latency, votes for satisfaction; cost and custom have no minimum), so two failed requests at 3 a.m. are not "100 % errors". With too little data the state is `no_data`, and **a firing alert is never resolved by missing data**: it stays firing until a real measurement is back inside the threshold. Transitions that notify: `ok → firing` (fired), `firing → ok` (resolved), and, if the rule has a reminder (at least 15 minutes), `firing → firing` after that time. Every transition is stored in `alert_events`.

### 3. Cost budgets

An experiment may have a monthly budget in USD with a warning percentage (80 by default). The evaluator notifies **once per month and level**: *warning* (spend reaches the percentage), *exceeded* (100 %) and *forecast* (the month-end projection exceeds the budget, from day 3). Spend comes from `experiment_daily_cost`, a table of daily costs that the job refreshes for today and yesterday. Reading month-to-date straight from traces would be wrong whenever trace retention (ADR-084) is shorter than the days elapsed in the month, and would fail on day 31 because the query API caps ranges at 30 days. Cost is an estimate from the pricing catalog; models without a price count as zero. The Overview also draws the month so far and its projection **for agents without a budget**, so the evaluator keeps `experiment_daily_cost` up to date for every active agent (`lifecycle = 'active'`), not only for those with an enabled budget. For those without one the cost is refreshed at most every 30 minutes, with the same rule as for budgets (today and yesterday every time, the missing days of the month once), and no notice is ever sent. The alerts overview returns it as `monthCost` (spend, projection, `daily`), with or without `budget`. The table holds numbers per day and no content, so it is not subject to trace retention (ADR-084); only the current month is read and nothing purges older rows yet.

### 4. Delivery: email and the app, to a list of addresses

Each rule and budget carries its own list of email addresses (up to 10), including people without an account. That makes MemTrace able to send email to arbitrary addresses, so it is bounded:

* only `alert:manage` (the `technical` profile) can set recipients;
* the message is fixed and carries no trace content: the rule name and experiment name (escaped), the metric, the value, the threshold and a link;
* a cooldown of at least 15 minutes between reminders, and a cap of 100 alert emails per organization per day, after which the alert is still recorded and shown in the app but not mailed (and the event says so);
* every create, change and delete of a rule or budget is recorded in the audit log.

In the app, a bell in the top bar lists the alerts that are firing in the experiments the person can read, and the experiment has an **Alerts** page with its rules, budget and history.

### 5. Permissions

`alert:manage` creates, edits and deletes rules and budgets (`technical`). Reading rules, state and history needs only `experiment:read`, so a `business` profile can see that something is wrong. `org_admin` does not read data (ADR-052) and gets neither.

## Considered Options

* **Evaluate inside the API process on a timer.** Couples availability of alerts to the web server and runs once per replica. A CronJob is already the pattern for the health probe and retention.
* **Push evaluation from the Collector.** Would give seconds of latency but needs a metrics pipeline MemTrace does not have, and cannot evaluate custom charts or satisfaction.
* **Recipients only from the experiment's members.** Safer, but rules out the on-call alias or an operations mailbox that is not a MemTrace user; the decision was to allow free addresses and bound the risk.
* **Budget from trace queries.** Rejected: breaks under short retention and on 31-day months.

## Consequences

* Alerts need a working email provider (`RESEND_API_KEY`); without one they are still evaluated and shown in the app, and the event records that no mail was sent.
* Resolution is evaluated every five minutes, so an alert can lag by up to five minutes plus the window.
* A saved chart that is deleted leaves its rules without a metric: they show as invalid and stop firing instead of being deleted silently.
* Webhooks (Slack, Teams, PagerDuty) are not included. They need the same SSRF protection as the health probe and are the natural next step.
* The existing report and invitation emails interpolate names without escaping HTML. The alert email escapes everything it prints; the older ones are a separate follow-up.

## Update 2026-10-25: security and evaluation-quality rules (decided, not implemented)

Two new families of rules, on the same state machine, delivery and permissions as above. They answer "alert me when security degrades" and "alert me when an evaluation gets worse". Online quality alerts stay discarded (backlog F3/R10): nothing here reads production trace content.

### Security detections: a windowed metric, like `error_rate`

* New metrics `security_detections` (detections in the window) and `security_blocked` (tool calls blocked by `ToolPolicy`), counted from the `security.*` spans of ADR-103. The unit is a count, `min_samples` is 0 (as in cost), and the condition is "more than N in W minutes".
* Optional filters by detector and by severity. A single `secret_leak` is an incident, so the suggested starting rule is "at least 1 `secret_leak`", not a rate.
* The query is the one behind the Security page: it excludes the playground and `security.context=redteam`, so red team runs never count as production.
* The metric is only meaningful if the agent enabled the detectors. Without them the rule never fires; the UI says so instead of showing a green state that means nothing.

### Evaluation quality: an event metric, not a windowed one

Offline runs (red team included) are launched by a person or by the agent's CI. MemTrace does not schedule them. The five-minute CronJob only looks for a new completed run:

* A rule targets a dataset (or a run-name prefix such as `redteam/`) and one evaluator. It reads that evaluator's score on the **latest completed run** from `dataset_runs` and its scores, not from ClickHouse.
* Two modes: **absolute** (the score is below X) and **drop** (the mean fell more than X points against the previous run of the same dataset and dataset version). The drop mode is ignored when the drop is smaller than the noise measured with `repeats` (ADR-044), so a non-deterministic judge does not raise false alarms. A minimum number of evaluated items plays the role of `min_samples`.
* It fires on the first cycle after a bad run arrives (up to five minutes later), and resolves only when a **later run** is back inside the threshold. A bad run does not resolve by itself with time, and if nobody evaluates again the alert stays firing. An errored item is not counted, as in the ASR.
* Applied to `redteam/` runs the same rule is "the attack success rate went up", so offline security needs no third mechanism.

### Not evaluated for a while

A rule "no completed run of this dataset or prefix in N days" (`no_data` in the state machine, with its own notification). The regression that hurts is the one nobody measured, and without it a bad red team run could stay unnoticed indefinitely.

### Consequences

* A migration will be needed if `alert_rules.metric` is constrained, plus fields for the detector and severity filters and for dataset, evaluator and mode. The rule form grows, and its UI proposal goes first in the design artifact.
* The evaluator reads two stores (ClickHouse for security, Postgres for evaluation) behind two ports; the domain stays free of both.
* MemTrace still cannot launch a red team run by itself. Triggering it on deploy belongs to the deploy gate (ADR-064), which is out of scope here.
