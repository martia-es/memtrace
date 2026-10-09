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
- **Resizable preview.** Drag the left edge of the panel to make it wider (or focus it and use the left/right arrow keys); double-click the edge to go back to the default width. The width is remembered in your browser.
- **Timeline under each reply.** Below every assistant reply, a thin line shows where the time of that turn went, as sequential steps: guardrails, model calls, tools. Each step is as wide as its duration, with its name and time underneath; hover a step for details. Click the line (or the **Timeline** header) to expand it into the steps with what ran inside each one — for example the checks of a guardrail — a time axis, and the slowest step highlighted. **Open in trace** jumps to the full trace. Wrapper spans such as the agent run are looked through, and a guardrail counts as one step when its name or `step_type` contains `guardrail` (see [Tracing steps](/library/tracing)).

Open a conversation to see its turns in order, as a table or as a unified span tree.

## Traces

One trace is one run of your agent. The Traces list shows the root span, input and output preview, start time, duration, tokens, status and the conversation it belongs to. If the run failed before the agent produced an answer (for example, the model call returned a quota error after a tool had already run), the Output column shows the error message in red instead of the tool's result.

A trace has two tabs:

- **Conversation** reads the messages like a chat: what the user asked, which tools the assistant used and what it answered, without ids or raw JSON.
- **Technical trace** is the span tree with timings and, next to it, the selected span's input, output and metadata. This is the default.

**Annotate**, **Add to queue** and **Add to dataset** are available from the header.

If the people using your agent voted 👍/👎 on the answer (see [User feedback](/library/feedback)), a colored strip under the header shows the votes and their comments: green when 👍 win, red when 👎 win. A badge tells you whether the users agree with your reviewers; **Disagrees with the reviewers** is the most interesting case, because it can mean your review rubric misses what users care about. The Traces and Conversations lists have a **User feedback** column, and the Summary shows **User satisfaction** (% of 👍) with *Needs attention* items for 👎 and for those disagreements.

## Spans

Each span is a step: an LLM call, a tool, a retriever or an agent. Spans are color-coded by kind, and an LLM span shows model, provider, token counts, finish reason and, if captured, the messages. Errors show the status message.

## Overview

The sidebar groups its pages in submenus. **Overview** opens **Summary**, **Compare**, **Custom charts** and **Reports**; each one is its own page with its own link, so you can bookmark or share it. The time range applies to all of them.

### Summary

It starts with a plain statement of health ("Your assistant is healthy", "Some executions are failing" or "Your assistant needs attention") and one card per key figure, each with a small trend: conversations, success rate, response time p95, errors and cost.

Next to the **Activity** chart (conversations, errors and p95 latency over the range) sits **Needs attention**.

It lists what is worth a look, each with a direct action: executions that ended with errors, tools that fail in at least 2% of their calls, traces that a reviewer rated low (a "No" on a yes/no label, or a score below the middle of its range), and items waiting for review. When nothing needs attention it says so.

At the bottom, three cards: **Models** (p95 latency and cost per model), **Human review quality** (average reviewer score per criterion, from completed review queues; visible to technical profiles) and **Latest evaluation runs** (most recent runs with their first evaluator's result).

Below, when anything failed, **What is going wrong** explains the failures by cause in plain language, without reading traces: *AI provider usage limit reached*, *A service took too long to respond*, *An external service was unavailable*, *Access or credentials problem*, *Conversation too long for the model*, *Answer blocked by safety filters*, and so on. Each cause shows how many conversations it affects (and what share of the total), when it last happened, which tools or models are involved, and whether it grew or shrank compared with the previous period of the same length. Click a cause to see what it means, what to do and who to ask, plus the technical detail for your technical colleagues. Failures that match no known cause appear as *A tool failed for an unrecognised reason*; the technical team can use the detail to add a rule for them. Only the deepest failing step of each execution is counted, so one broken tool is not counted again in the steps that contain it. No AI is involved: the causes come from a fixed set of rules.

### Compare

Compares the selected agent (**A**, the baseline) against a second agent of your choice (**B**, the candidate) over the same time range. Use the swap button to exchange them. It requires access to at least 2 agents.

- **Verdict**: one sentence on how B differs from A (for example "B is cheaper and faster, but failing more often") and how many metrics are better, worse or neutral.
- **What changed from A to B**: one bar per metric (cost, tokens, latency p50/p95/p99, error rate, conversations, executions) showing the % change. Green is better, red is worse, grey is neutral. Lower cost, tokens, latency and error rate count as better; conversations and executions are volume, so they are never good or bad. Changes under 5% are shown as neutral to avoid highlighting noise.
- **Cost per execution** and **Input vs output tokens** (for each agent, what share of its tokens is the prompt and what share is the answer).
- Overlaid charts for executions, tokens and latency p95: A is a solid line, B a dashed one.

### Custom charts

A builder for charts over what your assistant does — model calls, tool calls and your own [custom steps](/library/tracing#custom-step-trees-fine-grained-non-llm-steps). It never requires writing a query, and it uses plain names (for example "Model calls" or "Tool calls") instead of technical ones.

**Start from a question.** The first thing you see is a list of questions such as "Which tools fail the most?" or "How many model calls do I make each day?", each one showing how much data it is based on. Picking one fills the chart in for you. They only appear when your traces contain the data they need, and each custom step you instrumented gets its own "how often does it happen / fail" questions. Once you start building, the questions shrink to a row of pills so you can switch at any time.

Or build one from the panel on the left, with the result on the right:

1. **I want to see…** — pick what happened (found in your traces for the selected time range, with how many times it happened). Pick several to compare them in one chart, for example your input guardrail and your tool calls: you get one line or bar per step, all measured the same way. Splitting by a detail and **Only when…** conditions apply to a single step, so they are available again when you pick just one. **Measured as…** how many times, how long it takes (average or in the slowest 5%), or the % that fail. Optionally **split by** a detail such as the tool or the model; the list offers the details that make sense to group by and hides the rest (see [Which details are offered](#which-details-are-offered)), which **Show more details** brings back. Add **Only when…** conditions to restrict it to certain values of a detail.
2. **See it** — the chart updates as you go. Choose over time, bars, pie, area, a single number or a table from the selector above the chart; one is suggested for you, and a sentence under the name describes exactly what the chart shows.
3. **Save it** — the name is suggested for you; edit it at the top of the chart and click **Save to Metrics**. The chart appears under **Saved charts** every time you open the page, and can be added to a report (below).

**Rename things.** The names come from your agent's code, so a step called `input_guardrail` shows as "Input guardrail". If your team calls it something else, press **Rename things** next to **I want to see…** and type the name you want for each step and each detail (the hidden ones stay out of the list until you tick **Show hidden details**). The field shows the automatic name until you write your own; empty it, or press **Reset**, to go back. A new name applies everywhere at once: the builder, its questions, the sentence under the chart, the **Saved charts** and the [reports](#reports), including charts you saved before renaming, because they remember the technical key and not the name. Two steps (or two details) cannot share a name. The names belong to the experiment, so everyone who opens it sees them. You need the `catalog:manage` permission, which the `technical` and `business` roles have.

#### Which details are offered

MemTrace looks at the values of each detail in the selected period and decides, with fixed rules and no AI, what to offer when you split or filter:

| It looks like… | Example | In the list |
|---|---|---|
| **A category**: a few different values | tool, city, model | Offered |
| **A number**: many different values that are numbers | order total, items | Offered |
| **An identifier**: different in almost every step, or named like an id | `customer_id`, uuid, hash | Hidden: a chart would get one bar per value |
| **Free text**: long values | a user message | Hidden |
| **Technical**: instrumentation detail | `memtrace.*`, token counts | Hidden |

**Show N more details** shows the hidden ones; a detail you already picked stays visible. To decide yourself, open **Rename things**: each detail shows what it looks like, how many different values it has and, if hidden, why. Its selector offers **Automatic**, **Always show** and **Always hide**. Your choice wins over the automatic one, applies to the whole experiment and needs the `catalog:manage` permission. A rating from 1 to 5 counts as a category even though its values are numbers. **Reset** on a name does not undo an **Always show** or **Always hide**.

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

The dashboard supports light and dark themes, switched from the user menu.

An `org_admin` can brand the dashboard for the whole organization in **Settings → Organization → Appearance**, with a live preview:

- **Accent color** and **secondary color** (used for highlights).
- **Corner style**: **Default**, **Sharp**, **Soft** or **Round**.
- **Font**: **Default**, **System**, **Serif** or **Humanist** (system fonts, nothing is downloaded).
- **Assistant**: the name shown in the chat, which views are available and which one opens by default.

The MemTrace logo and the colors of charts and spans do not change. The chat with an assistant uses the same colors, corners and font.

### Assistant views

The chat with an assistant (the **Talk** button) can be shown in three ways: a floating **bubble**, a **side panel** that moves the page aside instead of covering it, or **full screen** in a new browser tab. Use the icons in the chat header to switch between the views your organization allows; your choice is remembered in this browser. Switching to full screen keeps the current conversation.

## Code version

Every trace shows the **commit** of the code that produced it: next to the status in the trace detail (a link to the commit when the assistant declares its repository), and under the trace id in the traces list. In **Conversations** the *All versions* dropdown lists the commits that produced traces in the selected range, with how many traces each one has, and keeps only the conversations and traces of the one you pick. Traces without a commit are still listed; they just have no version. See [Code version on every trace](../library/configuration#code-version-on-every-trace) to make your assistant send it.
