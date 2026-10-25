# Alerts and cost budgets

MemTrace tells you when something goes wrong instead of waiting for you to open the dashboard. Open **Alerts & budget** in an agent to see its alerts, its monthly cost budget and what has fired.

Everyone who can read the agent can see its alerts. Creating, changing and deleting them needs the `alert:manage` permission, which the `technical` profile has.

## The Alerts screen

- A red banner at the top says how many alerts are firing right now and which ones.
- **Your alerts** lists each alert as a card, with the ones that are firing first and the paused ones last. Use **All, Firing, Healthy and Paused** to narrow the list.
- Each card shows the rule in one sentence, the value now, the limit, and a bar with a vertical mark at the limit. A bar that goes past the mark is over its limit.
- The switch on a card pauses or resumes the alert. **Edit** and **Delete** are next to it.
- The **history** is grouped by day and also records when an alert is back to normal.

## What you can watch

| Alert on | The value is | You write the threshold in |
|---|---|---|
| **Error rate** | Share of conversations whose last step failed | % |
| **Latency (p95)** | The time that 95 % of the answers stay under | milliseconds |
| **Cost** | Estimated spend inside the window | USD |
| **User satisfaction** | 👍 among the 👍 and 👎 votes of the end users | % |
| **Custom chart** | The number of a chart you saved in [Charts](/platform/dashboard) | whatever the chart measures |

Each alert says *when the value goes above or falls below a threshold over the last 5 minutes to 24 hours*. A custom chart alert needs a chart about **one step** and **not split by a detail**, because an alert is a single number.

When you create an alert you first choose **what to watch**: *Traffic* (everything above), *Security* or *Evaluation*. The cards in the list carry a tag with the kind.

## Security alerts

They count what the agent's [security detectors](/library/security) report, over a time window like the traffic alerts.

| Alert on | The value is |
|---|---|
| **Detections reported by the agent** | How many detections in the window, optionally only one detector (for example `secret_leak`) and one severity |
| **Blocked tool calls** | How many calls the [tool policy](/library/security) stopped before they ran |

You write the threshold as a number of events ("more than 0 `secret_leak` in 15 minutes" warns you about a single leaked secret). Detections made during a red team run are never counted.

::: warning Only what the agent reports
MemTrace counts the detections your agent sends with `memtrace.security`. If the detectors are not turned on, a security alert stays green without meaning anything.
:::

## Evaluation alerts

Offline evaluations (red team included) are started by your team or your CI: MemTrace does not schedule them. These alerts are therefore checked when a **new run finishes**, within five minutes, not on a time window. You choose a dataset by name, or a run prefix ending in `/` such as `redteam/` to cover every red team run.

| Alert on | The value is |
|---|---|
| **Score of the latest evaluation** | The pass rate of the latest finished run, in %. Either *below a value*, or *drops more than N points* against the previous run of the same dataset and version |
| **Days without an evaluation** | Days since the last finished run, so you notice that nobody has measured the agent for a while |

The score can be one score by name, or **any check** (empty): an item passes when none of its true/false scores fails, which is 100 % minus the attack success rate of a red team run. Items that failed to run do not count, and you set a minimum number of evaluated items (20 by default).

An evaluation alert resolves only when a **later run** is back inside the limit; time alone never resolves it. A drop is not compared with the noise of a repeated run yet, so a judge that varies can still fire on a small drop: set a threshold above the variation you measured with `repeats` (see [Offline evaluation](/library/evaluation)).

## How it works

MemTrace checks every alert every **5 minutes**. An alert is in one of these states:

| State | Meaning |
|---|---|
| **OK** | The last check was inside the threshold |
| **Firing** | The value crossed the threshold. You are emailed once |
| **Not enough data** | The window had fewer conversations or votes than the minimum you set (or an evaluation had too few items, or there is no run to compare with), so the value is not trustworthy |
| **Paused** | You switched the alert off |
| **Chart deleted** | A custom chart alert whose chart no longer exists. It stops firing instead of disappearing |

Two rules keep the alerts calm:

- **Too little data never fires.** For error rate, latency and satisfaction you set a minimum (20 by default): two failed conversations at 3 a.m. are not a 100 % error rate.
- **Missing data never resolves an alert.** If an alert is firing and the traffic stops, it stays firing until a real measurement is back inside the threshold.

You are emailed when an alert **fires** and when it is **back to normal**. You can also ask for a **reminder** (every 15 minutes up to every day) while it stays firing.

Changing an alert starts it from scratch: what was measured before no longer means the same.

## Who gets the email

Each alert has its own list of addresses, up to **10**. They do not need a MemTrace account, which makes it easy to use an on-call mailbox. Because that lets MemTrace send mail to any address, it is limited:

- only people with `alert:manage` can set addresses;
- each person gets their own email, so nobody sees the other addresses;
- the email has the alert name, the agent name, the rule, the value and a link. It never contains conversation content;
- an organization sends at most **100 alert emails a day**. After that alerts are still recorded and shown in the app (and the history says "Not emailed"), but not mailed.

## The bell

The bell at the top right of the dashboard works across every agent you can read. Its number is the alerts firing now plus the notifications you have not read yet; it turns red while an unread alert is firing.

The **Notifications** panel has three tabs:

- **All** shows what is firing now, and below it what happened recently.
- **Firing** shows only the alerts that are over their limit: the value now, your limit, the agent and for how long ("Latency (p95) is 2,807 ms. Your limit is 5 ms.").
- **Budget** shows the budget notices (warning, exceeded, forecast), with what you have spent of your monthly budget. The amount is an estimate from the price catalog.

Recent means the last 14 days, up to 30 notifications: alerts that fired or came back to normal, and budget notices. Reminders are not repeated here. A dot marks what you have not read, and **Mark all as read**, at the top of the bell on every tab, clears it, including the alerts firing now. An alert that is still firing stays in the list, only marked as read, and shows a dot again if it fires anew. The mark is yours: it does not change what anyone else sees.

**View alert**, **See costs** and **Manage alerts** take you to the Alerts screen of that agent. At the bottom the panel says how many addresses also get the alert by email. Budget notices sent before the amount was recorded say that the budget is filling up, without the figure.

## Monthly cost budget

The budget has its own view in **Overview › Summary**: [Spend this month](/platform/dashboard#summary) draws the spend so far and the forecast to the end of the month.

An agent can have a monthly budget in USD. You choose the warning percentage (80 % by default) and who is emailed. You get **one email per month and level**:

| Level | When |
|---|---|
| **Warning** | The spend reaches the warning percentage |
| **Exceeded** | The spend reaches 100 % |
| **Forecast** | At the pace of the month so far the spend would pass the budget (from the third day of the month) and the warning has not been reached yet |

If the spend jumps from 70 % to 120 % in one step you get "exceeded", not a late warning.

The cost is an **estimate** from the [price catalog](/platform/dashboard): a model without a price counts as zero. MemTrace keeps the cost of each day, so the month's figure stays right even when your traces are kept for fewer days than the month has elapsed.

## Every change is recorded

Creating, changing and deleting an alert or a budget appears in the organization's [audit log](/platform/data-protection#the-audit-log). The log keeps how many addresses an alert has, not the addresses.

## For the person who runs MemTrace

- The evaluator is the `alerts-evaluate` CronJob (every 5 minutes, same image as the API). To run it now: `kubectl -n memtrace create job --from=cronjob/alerts-evaluate alerts-now`.
- Emails need `RESEND_API_KEY` and `EMAIL_FROM`. Without them alerts are still evaluated and shown in the app, and the history records that no email went out.
- The links in the emails use `APP_URL` in the CronJob, which must be the public address of the dashboard.
- Alert history is kept for 90 days.

## What is not included

Webhooks (Slack, Teams, PagerDuty) are not available yet; email and the app are. An alert can lag up to five minutes plus its window.
