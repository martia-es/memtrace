# TypeScript SDK

`@memtrace-ai/sdk` is the TypeScript / Node.js (18+) SDK. It sends the same traces as the [Python SDK](./), with the same attribute names,
masking, environment variables and prompt, feedback and evaluation features, so one MemTrace project can mix agents written in both.

```bash
npm install @memtrace-ai/sdk
```

## Trace an agent

```ts
import { initTracer, withStep, traceLlmCall, session, shutdown } from "@memtrace-ai/sdk";

initTracer({ serviceName: "my-agent" });      // MEMTRACE_* variables configure the rest, see Configuration

await session("conversation-42", () =>
  withStep("turn", "chain", async () => {
    await withStep("answer", "llm", async () => {
      traceLlmCall("anthropic", "claude-x", { inputTokens: 7, outputTokens: 3 });
    });
  }),
);

await shutdown();                              // sends what is pending
```

`withStep(name, type, fn)` is the equivalent of the Python context manager and `traceStep(fn, { name, stepType })` of the decorator. Both work
with sync and async functions, keep the parent across `await`s and mark the step as failed if the function throws. Prompts and completions
are recorded only with `MEMTRACE_CAPTURE_CONTENT=true`, and secrets are masked either way. See [Tracing steps](./tracing) and
[Configuration](./configuration): the variables are the same.

## Frameworks

| Framework | Import | Notes |
|---|---|---|
| LangChain.js, LangGraph.js | `import { MemTraceCallbackHandler } from "@memtrace-ai/sdk/langchain"` | Pass it in `callbacks`. `thread_id` is the conversation |
| OpenAI Agents SDK | `import { enableOpenAIAgentsInstrumentation } from "@memtrace-ai/sdk/openai-agents"` | Call once after `initTracer`. The trace's `groupId` is the conversation |

Install the framework yourself (`@langchain/core`, `@openai/agents`): they are optional peer dependencies.

## Feedback, prompts and evaluation

```ts
import { feedback, prompts, runExperiment, exactMatch } from "@memtrace-ai/sdk";

await feedback(traceId, "up", { endUserId: "u-9" });           // see User feedback

const weather = await prompts.get("weather-system");            // async here; compile() is synchronous
const system = weather.compile({ city: "Sevilla" });            // see Prompts

await runExperiment({ data: { datasetId: "ds-1" }, task: (item) => myAgent(String(item.input)), evaluators: [exactMatch], name: "v2" });
```

These behave as described in [User feedback](./feedback), [Prompts](./prompts) and [Offline evaluation](./evaluation). Differences:

- Evaluators and the judges receive one object (`{ input, output, expectedOutput, metadata }`). A judge takes **your** model through an
  `LLMClient` (`complete({ system, prompt, model? })`); there is no default provider.
- To let MemTrace's [playground](./prompts) try a version in the real agent, mount `prompts.promptOverrideMiddleware()` after your body parser.
- `runExperiment({ ..., repeats: 3 })` runs the experiment three times in one call and returns a `RepeatedExperimentResult` (`executions`, and `summary()` with each evaluator's `values`, `mean` and `noise`). See [Measure the noise of an evaluation](./evaluation).
- There is no OTLP/gRPC, which the platform does not accept anyway.

## Personal data

Names and other personal data are masked only if you ask. Presidio has no JavaScript engine, so `presidioRedactor` asks a Presidio analyzer service
(same recognizers and models as the Python SDK) and masks the findings with `****`:

```bash
docker run -p 5002:3000 mcr.microsoft.com/presidio-analyzer
```

```ts
import { initTracer, presidioRedactor } from "@memtrace-ai/sdk";
initTracer({ redact: await presidioRedactor({ language: "es", url: "http://localhost:5002" }) });
```

Run the service next to the agent: the text of your spans is sent to it. If it stops answering, the content is replaced by `[UNSERIALIZABLE]`
and never exported unmasked. See [Personal data (PII)](./pii) for what is detected.
