# Dashboard

The dashboard organizes what your agents did as a hierarchy: **conversations → traces → spans**.

## Conversations

Traces that share the same conversation id (see [Conversations](/library/conversations)) are grouped into one conversation. Open one to see its turns in order, the transcript of user and assistant messages (requires [content capture](/library/configuration#privacy-and-content-capture)), and the span tree of each turn.

## Traces

One trace is one run of your agent. The list shows root span, service, duration, status, span count, errors, tokens and a preview of the input and output. Filter by time range, service, status, errors and minimum duration.

## Spans

Each span is a step: an LLM call, a tool, a retriever or an agent. Spans are color-coded by kind, and an LLM span shows model, provider, token counts, finish reason and, if captured, the messages. Errors show the status message.

## Overview metrics

Totals, latency, a time series, tokens per model and tool usage for the selected time range and experiment. If you have access to more than one agent, a token-usage comparison across all of them is shown at the top of the page; click an agent there (or use the agent selector next to the time range) to switch which one the rest of the page shows.

## Theme

The dashboard supports light and dark themes. An `org_admin` can set an accent color and corner style for their organization.
