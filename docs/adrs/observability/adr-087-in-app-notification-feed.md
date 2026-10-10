# ADR-087: In-app Notification Feed Derived from Alert History

* **Status**: Accepted
* **Date**: 2026-10-10
* **Deciders**: MemTrace Core Team
* **Related**: [ADR-086](adr-086-alerts-and-cost-budgets.md) (alerts, budgets and the bell)

## Context and Problem Statement

The bell of ADR-086 only listed the alerts that are firing right now. When an alert came back to normal, or a monthly budget crossed a level, the bell said nothing, and there was no way to tell what was new since the last visit. The redesigned bell needs recent notices (fired, resolved, budget) and an unread state, for each person.

## Decision Outcome

### 1. The feed is a query, not a table

A notification is not stored on its own. The feed is the union of two tables that already exist:

* `alert_events` rows of kind `fired` and `resolved` (reminders are left out: they repeat a problem the person already has);
* `budget_notifications` rows (one per experiment, month and level).

It covers the last **14 days**, at most **30** items, newest first, and only the experiments where the person has `experiment:read`, as in the open-alerts bell. When a month jumped from `warning` to `exceeded` both rows exist; only `exceeded` is shown. Budget items carry the *current* budget amount and warning percentage (`null` if the budget was removed since).

Storing notifications per user was rejected: it would copy every event for every member of the experiment, and the audience (who can read the agent) changes over time.

### 2. Read state is one timestamp per person

`notification_reads (user_id, read_at)` holds a single mark. A notification is unread when it is newer than the mark, or when the person has never marked anything. "Mark all as read" sets the mark to now and only ever moves it forward, so a client with a late clock cannot make old notices unread again. It needs no permission: it only changes the caller's own mark.

### 3. API

* `GET /api/v1/notifications` returns `{ items, unread }`; each item carries `read`.
* `POST /api/v1/notifications/read` returns `204`.

The firing section of the bell keeps using `GET /api/v1/alerts/open`: it is live state, while the feed is history.

## Consequences

* No new write path in the evaluator: the feed appears as soon as the events do.
* `unread` counts inside the 30 returned items, so it never goes above 30. That is enough for a badge.
* Per-notification read, snooze and per-person muting are not possible with one mark. If they are needed, a `notification_reads` row per notification would be the next step.
* Events are purged after 90 days (ADR-086), well beyond the 14-day window.
