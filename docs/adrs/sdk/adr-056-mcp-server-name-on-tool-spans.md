# ADR-056: MCP server name on tool spans

## Status

Accepted

## Context

ADR-053 §8 found that a tool served by an MCP toolset is indistinguishable from a local function in its span: Pydantic AI's tool span only carries `gen_ai.tool.name` and `gen_ai.tool.call.id`. The assistant registry therefore could not name the MCP servers an assistant uses, nor measure them, and left them to be declared by hand.

## Decision

- **A MemTrace attribute, `memtrace.mcp_server`**, holds the server name on the tool span (ADR-004: only where no standard attribute exists). It is absent for local functions.
- **The SDK stamps it for Pydantic AI.** `enable_pydantic_ai_instrumentation()` wraps `call_tool` of Pydantic AI's MCP toolset classes (`MCPServer` up to 1.x, `MCPToolset` from 2.x). The tool span is the *current* span while that method runs, so the wrapper only sets the attribute on it through the new `TracingService.annotate_current`. The name is the toolset's `id` (what the user called it), else the name the server announced.
- **The wrapper is installed once, defensively.** If Pydantic AI's MCP extra is not installed, or a class has no `call_tool`, nothing happens. The wrapper never raises into the agent: `annotate_current` is fail-safe.
- **Any other framework or hand-written tool** sets it with the existing `attributes` argument: `@trace_step(step_type="tool", attributes={"memtrace.mcp_server": "weather-mcp"})`.
- **The API reads it, no schema change.** `SpanAttributes` is a generic map (ADR-026). The tool usage query returns the server next to each tool. The observed-connections sync registers each server as `mcp_server` and links its tools through `via`; an MCP server's usage is the sum of its tools' calls and errors over 7 days.

## Consequences

- MCP servers show up for review in the registry without being declared, with calls and error rate, like tools.
- It wraps a method of a third-party library. A Pydantic AI release that renames `call_tool` silently stops the stamping (tools still appear, without a server). The SDK tests use a stand-in toolset, because Pydantic AI's MCP client (`fastmcp`) is not installed in the test environment: the wrapper is verified, but not against the real library.
- A tool exposed by two servers under one name collapses into one row (already accepted in ADR-053); the query keeps one server per tool.
- Remote agents (`memtrace.peer_agent`) are still pending.
