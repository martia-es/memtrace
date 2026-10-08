# ADR-071: Prompt Playground Against the Real Agent

* **Status**: Accepted — implemented (2026-10-08)
* **Date**: 2026-10-08
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-067](adr-067-prompt-registry-immutable-versions-and-tags.md), [ADR-068](adr-068-prompt-handle-trace-link-and-usage-report.md)
* **Related**: [ADR-055](../governance/adr-055-agent-chat-endpoint-and-proxy.md), [ADR-069](adr-069-evidence-per-prompt-version.md), [ADR-070](adr-070-prompt-promotion-gate.md)

## Context and Problem Statement

Prompt tools usually test a prompt by calling an LLM with the provider key you paste into them. That does not exercise the agent: its tools, retrieval, memory and framework are missing, so the answer is not what production would say. The team wants to try a version **in the real assistant**, without moving a tag and without redeploying.

## Decision Outcome

### MemTrace calls the agent's own chat; the agent asks MemTrace which prompt to use

The playground reuses the chat proxy of ADR-055 (same SSRF rules, same "no credentials" restriction). It adds one thing to the call: a **short-lived token** in the `x-memtrace-prompt-override` header. The agent's SDK, when it sees the token, asks MemTrace for the version that token grants and uses it **for that request only**:

```
UI ──POST /playground──▶ MemTrace ──chat + header token──▶ agent ──GET /prompts/resolve?override=token (agent API key)──▶ MemTrace
                         (mints the token, stores its hash)               (uses the granted version for this request)
```

No LLM key lives in MemTrace and no secret is shared with the agent.

### The token is a capability that MemTrace itself validates

`prompt_overrides` (migration 035): `token_hash` (SHA-256; the token is never stored), the agent, the prompt, the version, who created it and `expires_at` (**120 seconds**). Presenting it requires the agent's **API key** (the same credential as every SDK call) and increments `resolved_count`. A token is accepted only for the agent and the prompt it was issued for; an unknown, expired, foreign or other-prompt token answers `404`, indistinguishable from "does not exist".

This avoids the alternative — an HMAC signature with a shared secret — because MemTrace stores no secrets of the agents (ADR-055) and only keeps the hash of their API keys, which cannot sign anything. A token that MemTrace validates on use also gives the answer to "did the agent really apply it?".

### `applied`: the playground does not lie

An agent that does not read its prompt through `memtrace.prompts`, has the override switched off or lacks the middleware answers normally — with the tag's version — and the response would look like a valid test. The token's `resolved_count` settles it: if the agent never presented it, `applied` is `false` and the UI says in red that **the answer is not from that version**, and what to check. The same fact is the compatibility marker: the page also warns beforehand when no agent has reported reading the prompt in that environment (the heartbeat of ADR-068).

### Where an override can happen

- **Opt-in in the agent**: the SDK ignores the header unless `MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`, and the ASGI middleware does not even read it then. Without it nothing is fetched and nothing changes.
- **Never in production, by MemTrace**: the API refuses deployments whose environment is production (`isProduction`). In production a version is promoted (ADR-070), not tried. An agent that opts in everywhere still only receives tokens from MemTrace's playground, and MemTrace does not issue them for production.
- **Authorization**: `prompt:write` and read access to the experiment (running the agent has real effects: tools can write). The target must be a deployment without authentication, like the chat.
- **Failures never break a request**: no token, a malformed one (`mto_` + 10–200 URL-safe characters), a rejected one or MemTrace being unreachable all serve the normal version. A rejection is cached for a few minutes (a wrong token cannot hammer MemTrace); an outage is not.
- **Request isolation**: the token lives in a `ContextVar`, so concurrent requests, threads that copy the context and async tasks never see each other's token (tested).

### Playground traces are not evidence

A span run under an override carries `memtrace.playground=true` in addition to the prompt name and version. The evidence queries (ADR-069) and the attribution of evaluation runs to a version (ADR-070) **exclude** those spans: a person trying odd messages must not move the error rate of a version nor make a run pass the gate. The usage heartbeat (ADR-068) does not report overrides either; it keeps saying what the tag says.

### Replay of a real trace

The trace page offers **Try another prompt version** when the trace read its prompt from the registry (the stamp of ADR-068). It opens the prompt's **Try it** tab with the trace loaded: the person's last message and the original answer are taken from the captured content, so the same message can be run against other versions and compared with what was said. If content capture was off the page says so and the message is typed by hand. Multi-turn replay (re-sending the previous turns) is not done: each run is a new conversation with one message.

### API and SDK

- `POST /experiments/{id}/prompts/{promptId}/playground` `{ deploymentId, version, message }` → `{ reply, sessionId, traceId, latencyMs, version, applied }`.
- `GET /experiments/{id}/prompts/resolve?name=&override=<token>` (agent API key): the granted version; never cached (no `ETag`).
- SDK: `PromptOverrideMiddleware` (pure ASGI), `prompts.override(token)` for other frameworks, `MEMTRACE_ALLOW_PROMPT_OVERRIDE`. Two versions are compared by running them in parallel, each with its own token.

## Consequences

- **Good**: the test is the real behavior of the agent; no LLM keys in MemTrace; the token cannot be forged and dies in two minutes; the page can tell whether the test was valid.
- **Cost**: the team installs a middleware and sets an environment variable on its non-production deployments, and the agent must read its prompt through `memtrace.prompts` (as everything else in the registry already requires).
- **Risk**: running the agent has side effects (tools). It is limited to non-production environments and `prompt:write`, but a tool that writes to a shared staging system will write. The page says it runs the real agent.
- **Not done**: replaying earlier turns, tool mocking, running a draft that is not a saved version (a version is saved first; drafts arrive with the fix-from-failure phase), a limit of runs per minute.

## Alternatives considered

- **HMAC-signed header with a shared secret**: no round trip, but MemTrace would have to store a secret per agent or reuse the API key hash, which weakens both.
- **LLM call from the server with a provider key**: standard elsewhere, but it does not run the agent's tools, RAG or memory.
- **A dedicated preview deployment per test**: exact, but slow and expensive; the override reuses the running agent.
