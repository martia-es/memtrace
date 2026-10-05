# Dashboard

The dashboard organizes what your agents did as a hierarchy: **conversations → traces → spans**. It is built so that someone from the business side can see how an assistant is doing at a glance, and an engineer can open the same screen and go down to the exact span.

## Navigation

The sidebar has five entries, plus **Settings** at the bottom:

| Entry | What it is for |
|---|---|
| **Overview** | How the assistant is doing right now, and what needs attention |
| **Conversations** | Browse and read what your assistants did |
| **Review** | Your inbox of conversations waiting for a human review |
| **Evaluations** | Datasets and their runs |
| **Costs** | Price per model |

The **experiment** selector at the top of the sidebar switches between the agents you have access to. The badge next to **Review** is the number of items waiting for review.

## Conversations

By default the list shows one row per conversation: traces that share the same conversation id (see [Conversations](/library/conversations)) are grouped together. Switch to **Traces** to see every run of your agent as its own row.

- **Quick views.** **All**, **With errors** and, in the Traces view, **Slow (≥ 5 s)** are shortcuts to the filters you use most. The time range, live refresh and the summary figures sit above the list.
- **Readable rows.** Each conversation is named after the user's first message (the id stays underneath) and shows its cost. If the agent did not capture content, the id is the name and the cost shows only when the model has a known price.
- **Preview.** Click a row to read it in a panel on the right without leaving the list: the messages of a conversation (requires [content capture](/library/configuration#privacy-and-content-capture)) or the input and output of a trace, with its main figures. Double-click a row, press Enter, or choose **Open full view** to open it.

Open a conversation to see its turns in order, as a table or as a unified span tree.

## Traces

One trace is one run of your agent. The Traces list shows the root span, input and output preview, start time, duration, tokens, status and the conversation it belongs to. If the run failed before the agent produced an answer (for example, the model call returned a quota error after a tool had already run), the Output column shows the error message in red instead of the tool's result.

A trace has two tabs:

- **Conversation** reads the messages like a chat: what the user asked, which tools the assistant used and what it answered, without ids or raw JSON.
- **Technical trace** is the span tree with timings and, next to it, the selected span's input, output and metadata. This is the default.

**Annotate**, **Add to queue** and **Add to dataset** are available from the header.

## Spans

Each span is a step: an LLM call, a tool, a retriever or an agent. Spans are color-coded by kind, and an LLM span shows model, provider, token counts, finish reason and, if captured, the messages. Errors show the status message.

## Overview

The Overview page is organized into tabs: **Overview**, **Compare**, **Custom charts**, **Offline evals**, and one more tab per saved report. The time range applies to all of them.

### Overview tab

It starts with a plain statement of health ("Your assistant is healthy", "Some executions are failing" or "Your assistant needs attention") and the key figures: conversations, success rate, response time p95, errors and cost.

**Needs attention** lists what is worth a look, each with a direct action: executions that ended with errors, tools that fail in at least 2% of their calls, traces that a reviewer rated low (a "No" on a yes/no label, or a score below the middle of its range), and items waiting for review. When nothing needs attention it says so.

Below it are the activity and latency chart, tool usage, tokens, latency and cost per model.

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

## Evaluations

**Evaluations** groups two tabs: **Runs**, every run uploaded by the SDK, and **Datasets**, the versioned sets of examples your agent is evaluated against. To compare two runs, tick them in the Runs list (only completed runs can be compared) and choose **Compare runs**: it opens the comparison under **Overview → Offline evals**, with the first run you ticked as the baseline. See [Datasets & offline evals](/platform/evaluation).

## Review

**Review** opens on your inbox: how many conversations are waiting for you and a **Continue reviewing** button that jumps into the first queue with pending work. Below it, each queue shows its progress. Open one to review conversations one at a time. Labels can also be added to any trace from its **Annotate** panel. See [Annotations & review](/platform/annotations).

## Theme

The dashboard supports light and dark themes, switched from the user menu. An `org_admin` can set an accent color and corner style for their organization (**Default**, **Sharp**, **Soft** or **Round**).
