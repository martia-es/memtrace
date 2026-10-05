# ADR-055: Agent Chat Endpoint and Proxy

* **Status**: Accepted
* **Date**: 2026-10-05
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-053](adr-053-assistant-registry-data-model.md), [ADR-054](adr-054-experiment-is-an-agent.md)

## Context and Problem Statement

The agent's card shows where each environment lives and whether it is healthy, but not how to talk to it. The team wants a **Talk** button on the card that opens a small chat inside MemTrace, so anyone can try the agent in DEV, PRE or PRO without leaving the tool. Every agent has its own `/chat` with its own JSON shape, and its host changes per environment.

## Decision Outcome

### The path belongs to the agent, the host to the deployment

`chat_path` lives on `experiments` (the agent), not on `assistant_deployments`. The URL is always `deployment.api_url + experiment.chat_path`, so DEV, PRE and PRO share the path and cannot drift apart. No `chat_url` per deployment.

### The agent declares its JSON contract (migration `026_assistant_chat.sql`)

Besides the path, three columns say where things travel in the JSON body, so MemTrace adapts to each agent instead of forcing a format on it:

| Column | Default | Meaning |
|---|---|---|
| `chat_request_field` | `message` | key that carries the user's text |
| `chat_response_field` | `reply` | key (or dotted path, `data.answer`) with the answer |
| `chat_session_field` | `NULL` | key that carries the conversation id in the request and the response; `NULL` = no sessions |

`chat_path IS NULL` means "this agent has no chat": the card shows no button. A `CHECK` forces the path to start with `/`. The domain validates the rest (no `//host` tricks, no query, plain JSON keys).

### MemTrace proxies the call

`POST /experiments/{id}/assistant/deployments/{deploymentId}/chat` with `{ message, sessionId }` returns `{ reply, sessionId, latencyMs }`. The browser never calls the agent directly, for four reasons: no CORS to configure on every agent, the internal URL is not exposed, no credentials in the browser, and the same SSRF protection as the health probe.

- The outbound call goes through `HttpChatClient`, which shares `guardedLookup` with `HttpHealthProber`: the address is checked on the socket itself (DNS rebinding), loopback and private ranges are blocked unless `HEALTH_PROBE_ALLOW_PRIVATE_NETWORKS=true`, link-local and cloud metadata are never allowed, redirects are not followed and the response is capped at 1 MB.
- Timeout 60 s (`CHAT_TIMEOUT_MS`): an agent runs a model and tools, far more than a `/health`.
- Failures of the agent (down, timeout, non-2xx, a reply that does not match the declared field) are `502 Bad Gateway`; a missing chat path is `409`.
- **Only deployments with `auth_method = none`**. MemTrace never stores secrets of the assistants (ADR-053), so it cannot authenticate for the user. The button is hidden on the others. Supporting them needs a secrets decision of its own.
- **Permission**: whoever can read the card (`governance:read` or `assistant:manage`). No new permission yet; a per-environment policy (for example, PRO restricted) is a follow-up and would reuse the access grants of ADR-053.

### Dashboard

`AssistantChatDock` is mounted once in `MainLayout`: a panel at the bottom right that can be minimized, closed or reset, and whose conversation survives navigation between screens. Opening it on another agent or environment starts a new conversation. Complete answers for now (no streaming).

## Consequences

- One nullable column plus three defaults on `experiments`; no new table. Existing agents are untouched.
- The agent's own traces keep working: if it uses the SDK, each question from the panel is a normal trace.
- Chat history is not stored by MemTrace; it lives in the panel until closed.
- Not covered yet: streaming (SSE), authenticated deployments, a per-environment chat permission, and tagging the traces as coming from MemTrace.
