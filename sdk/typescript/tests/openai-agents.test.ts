import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  Agent, createFunctionSpan, createGenerationSpan, createGuardrailSpan, createHandoffSpan, createMCPListToolsSpan, createResponseSpan,
  run, setTraceProcessors, setTracingDisabled, tool, withTrace, Usage, type Model, type ModelRequest,
} from "@openai/agents";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush, initTracer, shutdown } from "../src/index.js";
import { MemTraceTracingProcessor, enableOpenAIAgentsInstrumentation } from "../src/openai-agents.js";

let exporter: InMemorySpanExporter;
beforeEach(() => {
  process.env.MEMTRACE_CAPTURE_CONTENT = "true";
  exporter = new InMemorySpanExporter();
  initTracer({ serviceName: "t", spanExporter: exporter });
  setTracingDisabled(false); // the Agents SDK turns tracing off when NODE_ENV is "test"
  setTraceProcessors([new MemTraceTracingProcessor()]);
});
afterEach(async () => { setTraceProcessors([]); await shutdown(); delete process.env.MEMTRACE_CAPTURE_CONTENT; });

const spans = async () => {
  await flush();
  const byName = new Map<string, ReadableSpan>();
  for (const s of exporter.getFinishedSpans()) byName.set(s.name, s);
  const names = new Map([...byName.values()].map((s) => [s.spanContext().spanId, s.name]));
  return { byName, parentOf: (name: string) => { const id = byName.get(name)?.parentSpanContext?.spanId; return id ? names.get(id) : undefined; } };
};

/** First call asks for the tool, the second answers; it makes no network call (and so creates no model spans). */
function fakeModel(): Model {
  let calls = 0;
  return {
    async getResponse(_request: ModelRequest) {
      calls++;
      const output = calls === 1
        ? [{ type: "function_call", callId: "c1", name: "weather", arguments: '{"city":"Madrid"}', status: "completed" }]
        : [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Sunny" }] }];
      return { usage: new Usage({ requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14 }), output, responseId: `r${calls}` } as any;
    },
    getStreamedResponse() { throw new Error("not used"); },
  };
}

const weather = tool({ name: "weather", description: "weather", parameters: z.object({ city: z.string() }), execute: async ({ city }) => `sunny in ${city}` });

describe("MemTraceTracingProcessor", () => {
  it("a real run becomes workflow, agent and tool steps, with the group id as the conversation", async () => {
    const agent = new Agent({ name: "Weather agent", instructions: "x", tools: [weather], model: fakeModel() });
    const result = await withTrace("Weather workflow", () => run(agent, "weather?"), { groupId: "conv-7" });
    expect(result.finalOutput).toBe("Sunny");

    const { byName, parentOf } = await spans();
    expect(parentOf("Weather workflow")).toBeUndefined();
    expect(parentOf("Weather agent")).toBeDefined();
    const tool_ = byName.get("weather")!;
    expect(tool_.attributes["memtrace.step_type"]).toBe("tool");
    expect(tool_.attributes["gen_ai.tool.name"]).toBe("weather");
    expect(tool_.attributes["gen_ai.tool.call.arguments"]).toContain("Madrid");
    expect(tool_.attributes["gen_ai.tool.call.result"]).toContain("sunny in Madrid");
    for (const [name, span] of byName) {
      expect(span.attributes["memtrace.framework"], name).toBe("openai-agents");
      expect(span.attributes["gen_ai.conversation.id"], name).toBe("conv-7");
    }
  });

  it("a generation span carries the GenAI attributes", async () => {
    await withTrace("wf", async () => {
      const span = createGenerationSpan({ data: { input: [{ role: "user", content: "hi" }], output: [{ role: "assistant", content: "hello" }], model: "gpt-x", model_config: { temperature: 0.3 }, usage: { input_tokens: 7, output_tokens: 3 } } });
      span.start(); span.end();
    });
    const llm = (await spans()).byName.get("openai: gpt-x")!;
    expect(llm.attributes).toMatchObject({
      "memtrace.step_type": "llm", "gen_ai.provider.name": "openai", "gen_ai.request.model": "gpt-x", "gen_ai.usage.input_tokens": 7,
      "gen_ai.usage.output_tokens": 3, "gen_ai.usage.total_tokens": 10, "gen_ai.request.temperature": 0.3,
    });
    expect(llm.attributes["gen_ai.output.messages"]).toContain("hello");
  });

  it("a response span reads the response object", async () => {
    await withTrace("wf", async () => {
      const span = createResponseSpan({});
      span.start();
      // the model adapter fills these in after the call, as @openai/agents-openai does
      span.spanData._input = "q";
      span.spanData._response = { id: "resp_1", model: "gpt-x-2025", usage: { input_tokens: 11, output_tokens: 5 }, output: [{ type: "message", content: "Sunny" }] };
      span.end();
    });
    const llm = (await spans()).byName.get("openai")!;
    expect(llm.attributes).toMatchObject({ "gen_ai.response.id": "resp_1", "gen_ai.response.model": "gpt-x-2025", "gen_ai.usage.input_tokens": 11, "gen_ai.usage.output_tokens": 5 });
    expect(llm.attributes["gen_ai.output.messages"]).toContain("Sunny");
  });

  it("handoffs, guardrails and MCP tools", async () => {
    await withTrace("wf", async () => {
      for (const span of [
        createHandoffSpan({ data: { from_agent: "triage", to_agent: "billing" } }),
        createGuardrailSpan({ data: { name: "no-pii", triggered: true } }),
        createFunctionSpan({ data: { name: "search", input: "q", output: "r", mcp_data: JSON.stringify({ server: "docs-mcp" }) } }),
        createMCPListToolsSpan({ data: { server: "docs-mcp", result: ["a", "b"] } }),
      ]) { span.start(); span.end(); }
    });
    const { byName } = await spans();
    expect(byName.get("handoff: triage -> billing")!.attributes["memtrace.step_type"]).toBe("chain");
    expect(byName.get("guardrail: no-pii")!.attributes["memtrace.metadata"]).toContain('"triggered":true');
    expect(byName.get("search")!.attributes["memtrace.mcp_server"]).toBe("docs-mcp");
    expect(byName.get("mcp list tools: docs-mcp")!.attributes["memtrace.mcp_server"]).toBe("docs-mcp");
  });

  it("a failed span ends with ERROR status", async () => {
    await withTrace("wf", async () => {
      const span = createFunctionSpan({ data: { name: "boom", input: "", output: "" } });
      span.start(); span.setError({ message: "tool exploded" }); span.end();
    });
    expect((await spans()).byName.get("boom")!.status.code).toBe(2);
  });

  it("enable registers one processor even if called twice", () => {
    setTraceProcessors([]);
    expect(enableOpenAIAgentsInstrumentation({ keepOpenAIExport: false })).toBe(enableOpenAIAgentsInstrumentation());
  });
});
