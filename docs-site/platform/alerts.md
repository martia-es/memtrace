# Alerts and cost budgets

MemTrace tells you when something goes wrong instead of waiting for you to open the dashboard. Open **Overview › Alerts** in an agent to see its alerts, its monthly cost budget and what has fired.

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
| **Custom chart** | The number of a chart you saved in [Custom charts](/platform/dashboard) | whatever the chart measures |

Each alert says *when the value goes above or falls below a threshold over the last 5 minutes to 24 hours*. A custom chart alert needs a chart about **one step** and **not split by a detail**, because an alert is a single number.

## How it works

MemTrace checks every alert every **5 minutes**. An alert is in one of these states:

| State | Meaning |
|---|---|
| **OK** | The last check was inside the threshold |
| **Firing** | The value crossed the threshold. You are emailed once |
| **Not enough data** | The window had fewer conversations or votes than the minimum you set, so the value is not trustworthy |
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

The bell at the top right of the dashboard counts the alerts that are firing now, in every agent you can read. Its **Notifications** panel shows, for each one, the value now, the limit, the agent and how long it has been firing. **View alert** and **Manage alerts** take you to the Alerts screen.

## Monthly cost budget

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
