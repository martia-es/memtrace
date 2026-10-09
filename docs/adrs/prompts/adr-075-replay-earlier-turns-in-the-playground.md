# ADR-075: Replay Earlier Turns in the Playground

* **Status**: Accepted — implemented (2026-10-09)
* **Date**: 2026-10-09
* **Deciders**: MemTrace Core Team
* **Extends**: [ADR-071](adr-071-playground-against-the-real-agent.md)
* **Related**: [ADR-055](../governance/adr-055-agent-chat-endpoint-and-proxy.md), [ADR-072](adr-072-drafts-and-fixes-from-failures.md)

## Context and Problem Statement

The playground (ADR-071) runs one message. Many failures only happen mid-conversation: the agent misreads the fifth message because of what was said in the first four. Testing a fix on the last message alone does not reproduce the failure. The team wants to bring a whole conversation from a trace and add earlier messages as context.

## Decision Outcome

### Replay the person's earlier messages in the agent's own session

`POST .../playground` accepts an optional `history`: up to **10** earlier messages of the person, in order. MemTrace sends them one by one to the agent's chat (ADR-055) in the **same session** — the session id the agent returns on the first call is sent back on the following ones — and then sends `message`. The same override token covers every call, so all turns run with the version being tested. Only the last answer is returned.

* No new contract with the agent: it uses the `sessionField` it already declares. If the agent keeps no session (`sessionField` is null) and `history` is not empty, the call fails with `409` and says why, instead of dropping the context silently. Without `history` nothing changes.
* The token lives `120 s × (turns + 1)` and the route may run up to 300 s, since the turns run one after another.

### The dashboard fills `history` from the conversation of a trace

Loading a trace also reads its conversation transcript and keeps the person's messages from the turns **before** that trace. They appear as editable rows that can be removed or added to. Nothing is loaded when the trace has no conversation or content capture is off.

## Consequences

* The agent's earlier **answers are generated again** with the tested version, they are not the original ones. This is faithful to "what would this version have said" but the context may differ from the original run. Injecting the original answers would need an agent-side contract (a history field) that every framework reads differently; it can be added later without breaking this one.
* Each replayed turn is a real call with its own tools and side effects, so a long history costs time and tokens. The limit of 10 keeps that bounded.
* Agents whose chat has no session cannot replay history; the error tells the person to configure the session field.
