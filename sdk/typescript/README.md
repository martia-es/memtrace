# @memtrace/sdk

MemTrace SDK for TypeScript / Node.js (>= 18). Same contract as the Python SDK ([ADR-095](../../docs/adrs/sdk/adr-095-multi-language-sdk-contract.md)):
both run the scenarios in [`../conformance`](../conformance).

**Status**: in progress. This version covers tracing (steps, sessions, LLM calls, content capture and masking, OTLP/HTTP export),
end-user feedback, the prompt registry and offline evaluation. Client-side PII masking and framework integrations follow.

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

## Feedback

```ts
import { currentTraceId, feedback, withStep } from "@memtrace/sdk";

const traceId = await withStep("turn", "chain", async () => { /* answer */ return currentTraceId(); });
await feedback(traceId!, "up", { endUserId: "u-9" });   // needs MEMTRACE_API_URL (with the experiment id) and MEMTRACE_API_KEY
```

## Prompts

```ts
import { prompts } from "@memtrace/sdk";

const weather = await prompts.get("weather-system");    // follows the tag named like MEMTRACE_ENVIRONMENT; fails at startup if it does not exist
const system = weather.compile({ city });               // per request: in memory, no network; stamps the version on the current step
```

A timer follows the tag (an unchanged tag costs an empty `304`), the last known version keeps serving if MemTrace is down, and
`MEMTRACE_PROMPT_CACHE_DIR` / `default` let an agent start while MemTrace is unreachable. Unlike Python, `prompts.get` is
`async` (there is no blocking network call in Node); `compile()` is synchronous in both.

To let MemTrace's playground try a version in the real agent (`MEMTRACE_ALLOW_PROMPT_OVERRIDE=true`), mount
`prompts.promptOverrideMiddleware()` after your body parser (Express / Connect / Node `http`), or wrap the handling of a request in
`prompts.override(prompts.overrideTokenOf(headers), () => ...)`.

## Evaluation

```ts
import { runExperiment, exactMatch, Correctness, RecallAtK, MemTraceResultsSink } from "@memtrace/sdk";

const result = await runExperiment({
  data: { datasetId: "ds-1", version: "2.1" },   // a MemTrace dataset (results upload to it), or a .json/.jsonl path, or plain rows
  task: (item) => myAgent(String(item.input)),
  evaluators: [exactMatch, new Correctness({ client: myLlm }), RecallAtK(5)],
  name: "v2",
});
console.log(result.datasetVersion, result.summary());
```

Pass `sink: null` to keep the result in memory. If `initTracer` ran, each item runs in its own `eval.item` trace, so the dashboard
shows its latency, tokens and cost. Retrieval metrics read `metadata.relevant_docs` and the chunks your retriever step reports with
`recordRetrievedChunks(docs)`.

**Judges bring their own model.** There is no default provider: `Correctness`, `Faithfulness` and `prompts.proposeFix` take any
`LLMClient`, an object with `complete({ system, prompt, model? })` that returns a string (or `{ text, model }` to report the model the
provider actually served). A judge's rubric fingerprint is identical to the Python SDK's.

## Development

```bash
npm install
npm run typecheck
npm test        # unit tests + the shared conformance scenarios
npm run build
```
