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

By default the list shows one row per conversation: traces that share the same conversation id (see [Conversations](/library/conversations)) are grouped together. Switch to **Traces** to see every run of your agent as its own row. Use the search box to find conversations (or traces) by text in the captured input or output; it needs message content capture enabled.

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

The sidebar groups its pages in submenus. **Overview** opens **Summary**, **Compare**, **Custom charts** and **Reports**; each one is its own page with its own link, so you can bookmark or share it. The time range applies to all of them.

### Summary

It starts with a plain statement of health ("Your assistant is healthy", "Some executions are failing" or "Your assistant needs attention") and one card per key figure, each with a small trend: conversations, success rate, response time p95, errors and cost.

Next to the **Activity** chart (conversations, errors and p95 latency over the range) sits **Needs attention**.

It lists what is worth a look, each with a direct action: executions that ended with errors, tools that fail in at least 2% of their calls, traces that a reviewer rated low (a "No" on a yes/no label, or a score below the middle of its range), and items waiting for review. When nothing needs attention it says so.

At the bottom, three cards: **Models** (p95 latency and cost per model), **Human review quality** (average reviewer score per criterion, from completed review queues; visible to technical profiles) and **Latest evaluation runs** (most recent runs with their first evaluator's result).

### Compare

Side by side comparison of the selected agent against a second agent of your choice, over the same time range: a table (executions, conversations, operations, error rate, latency percentiles, tokens, cost) plus overlaid charts for executions, tokens and latency p95. Requires access to at least 2 agents.

### Custom charts

A builder for charts over what your assistant does — model calls, tool calls and your own [custom steps](/library/tracing#custom-step-trees-fine-grained-non-llm-steps). It never requires writing a query, and it uses plain names (for example "Model calls" or "Tool calls") instead of technical ones.

**Start from a question.** The first thing you see is a list of questions such as "Which tools fail the most?" or "How many model calls do I make each day?", each one showing how much data it is based on. Picking one fills the chart in for you. They only appear when your traces contain the data they need, and each custom step you instrumented gets its own "how often does it happen / fail" questions. Once you start building, the questions shrink to a row of pills so you can switch at any time.

Or build one from the panel on the left, with the result on the right:

1. **I want to see…** — pick what happened (found in your traces for the selected time range, with how many times it happened). Pick several to compare them in one chart, for example your input guardrail and your tool calls: you get one line or bar per step, all measured the same way. Splitting by a detail and **Only when…** conditions apply to a single step, so they are available again when you pick just one. **Measured as…** how many times, how long it takes (average or in the slowest 5%), or the % that fail. Optionally **split by** a detail such as the tool or the model; technical details are hidden unless you choose **Show technical details**. Add **Only when…** conditions to restrict it to certain values of a detail.
2. **See it** — the chart updates as you go. Choose over time, bars, pie, area, a single number or a table from the selector above the chart; one is suggested for you, and a sentence under the name describes exactly what the chart shows.
3. **Save it** — the name is suggested for you; edit it at the top of the chart and click **Save to Metrics**. The chart appears under **Saved charts** every time you open the page, and can be added to a report (below).

While you build, the chart also shows the overall figure compared with the previous period of the same length (for example "4.9% ▲ +2.3 pts vs previous period"). When you split failure rates or times by a detail and one value stands out, a highlight tells you which one ("refund_lookup fails 2.3× more than the others").

### Reports

A report groups several of your saved custom charts into one named view, laid out on a free grid — you choose where each chart sits and how big it is. Open **Overview → Reports** and click **+ New report** to create one. The page lists every report, and each one opens on its own page that any teammate with access to this experiment also sees (same visibility as a saved chart).

Click **Edit layout** on a report's page to drag and resize its charts, or add more from your already-saved charts — nothing is duplicated, a report only arranges charts you saved in Custom charts, so editing a chart there updates it everywhere it's used. **Save layout** commits the arrangement; **Cancel** discards it.

**Send by email** sends everyone you list a text summary of the report — one table of values per chart, recomputed at send time — directly to their inbox. There's no PDF or image attachment yet; it's a quick way to share current numbers without opening the dashboard.

## Evaluations

**Evaluations** opens **Runs**, every run uploaded by the SDK; **Datasets**, the versioned sets of examples your agent is evaluated against; and **Trends**, how scores evolve across runs. To compare two runs, tick them in the Runs list (only completed runs can be compared) and choose **Compare runs**: it opens the comparison under **Evaluations → Trends**, with the first run you ticked as the baseline. See [Datasets & offline evals](/platform/evaluation).

## Review

**Review** opens **My inbox**: how many conversations are waiting for you and a **Continue reviewing** button that jumps into the first queue with pending work. Below it, each queue shows its progress. **All queues** lists every active queue and **Archived** the ones that were put away. Open one to review conversations one at a time. Labels can also be added to any trace from its **Annotate** panel. See [Annotations & review](/platform/annotations).

## Theme

The dashboard supports light and dark themes, switched from the user menu. An `org_admin` can set an accent color and corner style for their organization (**Default**, **Sharp**, **Soft** or **Round**).
