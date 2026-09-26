# ADR-013: Conversation Transcript from Captured LLM Messages

* **Status**: Accepted
* **Date**: 2026-09-26
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

The conversation view (ADR-012) shows turns, times, tokens and errors, but not what was said. Reading it required opening each trace and the LLM span's "Contenido" tab. The messages exist only when the agent captured content (`MEMTRACE_CAPTURE_CONTENT=true`, ADR-004).

## Decision Outcome

1. **A server-side endpoint, not N client calls**: `GET /api/v1/conversations/{id}/transcript` reads the LLM spans (`gen_ai.operation.name = 'chat'`) of the conversation in one query, using the `ConversationId` column and its index (ADR-012), and returns `{ conversationId, contentCaptured, truncated, turns: [{ traceId, startTime, model, user, assistant }] }`. 404 if the conversation does not exist.
2. **Extraction is pure domain logic** (`buildTranscript`), independent of ClickHouse:
   - the *user* text of a turn is the **last `user` message of the first LLM call's input** (earlier messages are resent history);
   - the *assistant* text is the **last `assistant` message with text of the last LLM call's output** (calls that only invoke tools have no text and are skipped);
   - roles are normalised (`human`→user, `ai`→assistant; LangChain and the SDK use different names); multimodal content is reduced to its text parts;
   - the SDK truncates long content (`…[truncated]`), which yields invalid JSON: it is kept as raw text instead of being dropped.
3. **Explicit "content not captured" state**: `contentCaptured=false` (no span carried messages) is a normal response, not an error, so the UI can explain how to enable capture instead of showing an empty page.
4. **Bounded**: at most 500 LLM spans per transcript (`truncated: true` beyond that), because each span's messages can be up to 16 KB.
5. **Dashboard**: a "Transcripción" tab in the conversation view (URL `?tab=transcript`), loaded on demand, rendered as chat bubbles with a link to each turn's trace; refreshed by the live interval only while the tab is open.

## Consequences

- **Positive**: one query and one request per transcript; the read reuses the conversation index; extraction is unit-tested without a database.
- **Negative**:
  - **Privacy**: transcripts expose whatever the agent stored, unredacted (redaction is out of scope, ADR-004); it is a reason to keep capture opt-in and the API unexposed beyond localhost.
  - Only *LLM-visible* messages: tool inputs/outputs, retrieved documents and non-LLM steps are not part of the transcript.
  - The heuristics (first input / last output per turn) assume one user message per turn; agents that interleave several user messages within a trace show only the first.
  - Turns without LLM spans, or whose content was truncated beyond recovery, do not appear.
  - Reading message attributes still touches the attribute map, but only for the chat spans of one conversation.
