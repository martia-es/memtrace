import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { RunnableLambda } from "@langchain/core/runnables";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush, initTracer, shutdown, withStep } from "../src/index.js";
import { MemTraceCallbackHandler } from "../src/langchain.js";

let exporter: InMemorySpanExporter;
beforeEach(() => { process.env.MEMTRACE_CAPTURE_CONTENT = "true"; exporter = new InMemorySpanExporter(); initTracer({ serviceName: "t", spanExporter: exporter }); });
afterEach(async () => { await shutdown(); delete process.env.MEMTRACE_CAPTURE_CONTENT; });

const spans = async () => {
  await flush();
  const byName = new Map<string, ReadableSpan>();
  for (const s of exporter.getFinishedSpans()) byName.set(s.name, s);
  const names = new Map([...byName.values()].map((s) => [s.spanContext().spanId, s.name]));
  return { byName, parentOf: (name: string) => { const id = byName.get(name)?.parentSpanContext?.spanId; return id ? names.get(id) : undefined; } };
};

describe("MemTraceCallbackHandler", () => {
  it("maps a chat model run: provider, model, tokens, finish reason, messages and the parent chain", async () => {
    const handler = new MemTraceCallbackHandler();
    handler.handleChainStart({ id: ["x", "agent"] }, { q: "hi" }, "c1", undefined, ["a"], { thread_id: "t1" }, undefined, "agent");
    handler.handleChatModelStart({ id: ["langchain", "ChatAnthropic"] }, [[new HumanMessage("hello")]], "l1", "c1", {}, [], { ls_provider: "anthropic", ls_model_name: "claude-x", ls_temperature: 0.1 });
    const message = new AIMessage({ content: "ey", id: "msg_1", usage_metadata: { input_tokens: 7, output_tokens: 3, total_tokens: 10 }, response_metadata: { model_name: "claude-x-2024", stop_reason: "end_turn" } });
    handler.handleLLMEnd({ generations: [[{ text: "ey", message }]] }, "l1");
    handler.handleToolStart({ name: "search" }, "q", "t1r", "c1");
    handler.handleToolError(new Error("x"), "t1r");
    handler.handleChainEnd({}, "c1");

    const { byName, parentOf } = await spans();
    const llm = byName.get("ChatAnthropic: claude-x")!;
    expect(llm.attributes).toMatchObject({
      "memtrace.step_type": "llm", "gen_ai.provider.name": "anthropic", "gen_ai.request.model": "claude-x", "gen_ai.response.model": "claude-x-2024",
      "gen_ai.usage.input_tokens": 7, "gen_ai.usage.output_tokens": 3, "gen_ai.usage.total_tokens": 10, "gen_ai.request.temperature": 0.1,
      "gen_ai.response.id": "msg_1",
    });
    expect(llm.attributes["gen_ai.response.finish_reasons"]).toEqual(["end_turn"]);
    expect(JSON.parse(llm.attributes["gen_ai.input.messages"] as string)).toEqual([{ role: "human", content: "hello" }]);
    expect(parentOf("ChatAnthropic: claude-x")).toBe("agent");
    expect(byName.get("agent")!.attributes).toMatchObject({ "gen_ai.conversation.id": "t1", "memtrace.framework": "langchain" });
    expect(byName.get("search")!.status.code).toBe(2);
  });

  it("hangs from the current step and keeps content off when capture is disabled", async () => {
    await shutdown();
    delete process.env.MEMTRACE_CAPTURE_CONTENT;
    exporter = new InMemorySpanExporter();
    initTracer({ serviceName: "t", spanExporter: exporter });
    const handler = new MemTraceCallbackHandler();
    withStep("turn", "chain", () => {
      handler.handleChainStart(null, { secret: "x" }, "c1", undefined, undefined, undefined, undefined, "inner");
      handler.handleChainEnd({ out: 1 }, "c1");
    });
    const { byName, parentOf } = await spans();
    expect(parentOf("inner")).toBe("turn");
    expect(byName.get("inner")!.attributes).not.toHaveProperty("memtrace.input");
  });

  it("traces a real runnable, with the model call under its sequence", async () => {
    const model = new FakeListChatModel({ responses: ["hola"] });
    const chain = RunnableLambda.from((q: string) => q.toUpperCase()).withConfig({ runName: "shout" }).pipe(model);
    await chain.invoke("hi", { callbacks: [new MemTraceCallbackHandler()] });
    const { byName } = await spans();
    expect(byName.get("shout")).toBeDefined();
    expect([...byName.values()].some((s) => s.attributes["memtrace.step_type"] === "llm")).toBe(true);
  });

  it("traces a real LangGraph graph: nodes under the graph run, thread_id as the conversation, everything as langgraph", async () => {
    const State = Annotation.Root({ question: Annotation<string>(), answer: Annotation<string>() });
    const model = new FakeListChatModel({ responses: ["hi"] });
    const graph = new StateGraph(State)
      .addNode("agent", async (s) => ({ answer: String((await model.invoke(s.question)).content) }))
      .addNode("post", (s) => ({ answer: s.answer.toUpperCase() }))
      .addEdge(START, "agent").addEdge("agent", "post").addEdge("post", END)
      .compile({ checkpointer: new MemorySaver() });
    await graph.invoke({ question: "x" }, { callbacks: [new MemTraceCallbackHandler()], configurable: { thread_id: "T1" } });

    const { byName, parentOf } = await spans();
    expect(parentOf("agent")).toBe("LangGraph");
    expect(parentOf("post")).toBe("LangGraph");
    for (const [name, span] of byName) {
      expect(span.attributes["memtrace.framework"], name).toBe("langgraph");
      expect(span.attributes["gen_ai.conversation.id"], name).toBe("T1");
    }
  });
});
