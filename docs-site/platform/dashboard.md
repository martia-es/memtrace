# Dashboard

The dashboard organizes what your agents did as a hierarchy: **conversations → traces → spans**.

## Conversations

Traces that share the same conversation id (see [Conversations](/library/conversations)) are grouped into one conversation. Open one to see its turns in order, the transcript of user and assistant messages (requires [content capture](/library/configuration#privacy-and-content-capture)), and the span tree of each turn.

## Traces

One trace is one run of your agent. The list shows root span, service, duration, status, span count, errors, tokens and a preview of the input and output. Filter by time range, service, status, errors and minimum duration.

## Spans

Each span is a step: an LLM call, a tool, a retriever or an agent. Spans are color-coded by kind, and an LLM span shows model, provider, token counts, finish reason and, if captured, the messages. Errors show the status message.

## Metrics

The Metrics page is organized into tabs: **Overview**, **Compare**, **Custom charts**, and one more tab per saved report. The agent selector next to the time range applies to all of them, and switching it reloads whichever tab is open.

### Overview

Totals, latency, a time series, tokens per model and tool usage for the selected time range and experiment.

### Compare

Side by side comparison of the selected agent against a second agent of your choice, over the same time range: a table (executions, conversations, operations, error rate, latency percentiles, tokens, cost) plus overlaid charts for executions, tokens and latency p95. Requires access to at least 2 agents.

### Custom charts

A builder for charts over your own [custom step types](/library/tracing#custom-step-trees-fine-grained-non-llm-steps) (e.g. a guardrail check traced as its own span). It never requires writing a query — everything is picked from what your own traces already contain:

1. **Chart type** — bars, pie, line, area, a single number, or a table.
2. **Step type(s)** — detected from your traces for the selected time range.
3. **Metric** — count, average/median (p50)/p95 duration, or error rate.
4. **Group by attribute** (optional) — a dropdown of attribute keys actually seen on the selected step type(s); picking one breaks the chart down by that attribute's values instead of by step type. For a line/area chart this becomes one line per value.
5. **Filters** (optional, any number) — each filter picks an attribute and, from the values actually seen, which ones to include, narrowing the dataset before the metric is computed.

The panel shows in plain text what ends up on the X axis and what the series are, before you preview. Once you're happy with a chart, name it and save it — it appears in this tab every time you open the page, and can then be added to a report (below).

### Reports

A report groups several of your saved custom charts into one named view, laid out on a free grid — you choose where each chart sits and how big it is. Click **+ New report** next to the tabs to create one; it then gets its own tab, which any teammate with access to this experiment also sees (same visibility as a saved chart).

Click **Edit layout** on a report's tab to drag and resize its charts, or add more from your already-saved charts — nothing is duplicated, a report only arranges charts you saved in Custom charts, so editing a chart there updates it everywhere it's used. **Save layout** commits the arrangement; **Cancel** discards it.

**Send by email** sends everyone you list a text summary of the report — one table of values per chart, recomputed at send time — directly to their inbox. There's no PDF or image attachment yet; it's a quick way to share current numbers without opening the dashboard.

## Review

Review queues turn "someone should look at these traces" into a process: a batch of traces, a rubric and a progress bar. The **Review** page lists the experiment's queues; **Review** opens one trace at a time next to the rubric, and **Details** shows progress per reviewer. Experiment admins create and archive queues; any member can add traces and review. See [Reviewing traces with a queue](/library/evaluation#reviewing-traces-with-a-queue). A queue's **Details** also show how much its reviewers agree, and a run's page shows how well the LLM judge agrees with human labels (see [Can you trust the judge?](/library/evaluation#can-you-trust-the-judge-agreement-with-human-labels)).

## Theme

The dashboard supports light and dark themes. An `org_admin` can set an accent color and corner style for their organization.
