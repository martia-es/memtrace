# @memtrace/sdk

MemTrace SDK for TypeScript / Node.js (>= 18). Same contract as the Python SDK ([ADR-095](../../docs/adrs/sdk/adr-095-multi-language-sdk-contract.md)):
both run the scenarios in [`../conformance`](../conformance).

**Status**: in progress. This version covers tracing (steps, sessions, LLM calls, content capture and masking, OTLP/HTTP export).
Feedback, prompts, evaluation and framework integrations follow.

```ts
import { initTracer, withStep, traceLlmCall, session, shutdown } from "@memtrace/sdk";

initTracer({ serviceName: "my-agent" });          // MEMTRACE_* variables configure the rest

await session("conversation-42", () =>
  withStep("turn", "chain", async () => {
    await withStep("answer", "llm", async () => {
      traceLlmCall("anthropic", "claude-x", { inputTokens: 7, outputTokens: 3 });
    });
  }),
);

await shutdown();                                  // flushes what is pending
```

`traceStep(fn, { name, stepType })` wraps a function so every call is a step; with `MEMTRACE_CAPTURE_CONTENT=true` it records
the arguments and the result. Secrets are masked (`****`) before anything leaves the process.

## Development

```bash
npm install
npm run typecheck
npm test        # unit tests + the shared conformance scenarios
npm run build
```
