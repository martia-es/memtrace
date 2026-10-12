import { describe, expect, it } from "vitest";
import { conversationSteps, fieldsOf } from "@/domain/conversation-steps";
import { node } from "../fakes";

const guard = (name: string, extra = {}) => node({ spanId: name, name, kind: "chain", durationMs: 1, ...extra });
const llm = (spanId: string, over = {}) =>
  node({ spanId, name: "chat gemini", kind: "llm", durationMs: 100, genAi: { operation: "chat", provider: "google", requestModel: "gemini-2.5-flash", responseModel: null, inputTokens: 10, outputTokens: 5, totalTokens: 15, finishReasons: [], temperature: null, maxTokens: null, toolName: null, toolCallId: null }, costUsd: 0.001, ...over });

describe("conversationSteps", () => {
  it("is empty when the trace has no guardrail, retrieval, tool or model call", () => {
    expect(conversationSteps([node({ children: [node({ spanId: "x", kind: "chain" })] })])).toEqual([]);
  });

  it("groups the guardrail checks into one step, in the order of the trace", () => {
    const root = node({ spanId: "r", kind: "agent", children: [node({ spanId: "ig", name: "input_guardrail", children: [guard("guardrail.length"), guard("guardrail.pii")] }), llm("l1")] });
    const steps = conversationSteps([root]);
    expect(steps.map((s) => s.kind)).toEqual(["guardrails", "reply"]);
    expect(steps[0]).toMatchObject({ failed: false, checks: [{ name: "Length", failed: false }, { name: "Pii", failed: false }] });
  });

  it("marks the guardrail step as blocked when a check stopped the message", () => {
    const root = node({ spanId: "r", children: [guard("guardrail.pii", { status: { code: "error", message: "personal data" } }), guard("guardrail.blocked", { attributes: { "guardrail.check": "pii" } })] });
    const [step] = conversationSteps([root]);
    expect(step).toMatchObject({ kind: "guardrails", failed: true });
    expect(step!.error).toContain("pii");
  });

  it("reads the retrieved passages, their source and score, from the retriever span", () => {
    const chunks = JSON.stringify([{ text: "Cabin bag 10 kg", source: "baggage", score: 0.91 }, { text: "Check-in closes", id: "checkin", score: 0.4 }, { text: "no score" }]);
    const root = node({ spanId: "r", children: [node({ spanId: "rt", kind: "retriever", durationMs: 184, attributes: { "memtrace.retriever.chunks": chunks }, content: { input: '{"query":"hand luggage"}' } })] });
    const [step] = conversationSteps([root]);
    expect(step).toMatchObject({ kind: "retrieval", query: "hand luggage", durationMs: 184 });
    expect(step!.kind === "retrieval" && step!.chunks).toEqual([
      { rank: 1, text: "Cabin bag 10 kg", source: "baggage", score: 0.91 },
      { rank: 2, text: "Check-in closes", source: "checkin", score: 0.4 },
      { rank: 3, text: "no score", source: null, score: null },
    ]);
  });

  it("shows a retriever tool once, as a retrieval, not also as a tool call", () => {
    const retriever = node({ spanId: "rt", kind: "retriever", attributes: { "memtrace.retriever.chunks": "[]" } });
    const tool = node({ spanId: "t", kind: "tool", name: "execute_tool search_docs", children: [retriever] });
    expect(conversationSteps([node({ children: [tool] })]).map((s) => s.kind)).toEqual(["retrieval"]);
  });

  it("describes a tool call with what it asked and returned, and keeps a failure's message", () => {
    const ok = node({ spanId: "t1", kind: "tool", name: "execute_tool get_weather", genAi: { operation: "execute_tool", provider: null, requestModel: null, responseModel: null, inputTokens: null, outputTokens: null, totalTokens: null, finishReasons: [], temperature: null, maxTokens: null, toolName: "get_weather", toolCallId: null }, content: { toolArguments: { location: "Granada", days: 7 }, toolResult: '{"temperature_c":28.1,"condition":"nublado"}' } });
    const bad = node({ spanId: "t2", kind: "tool", name: "execute_tool get_flight", status: { code: "error", message: "Timeout" } });
    const [a, b] = conversationSteps([node({ children: [ok, bad] })]);
    expect(a).toMatchObject({ kind: "tool", name: "get_weather", label: "Get weather", failed: false, asked: [{ key: "location", value: "Granada" }, { key: "days", value: "7" }], returned: [{ key: "temperature c", value: "28.1" }, { key: "condition", value: "nublado" }] });
    expect(b).toMatchObject({ kind: "tool", name: "get_flight", failed: true, error: "Timeout" });
  });

  it("keeps plain-text tool results as text", () => {
    const tool = node({ spanId: "t", kind: "tool", name: "execute_tool echo", content: { toolResult: "all good" } });
    expect(conversationSteps([node({ children: [tool] })])[0]).toMatchObject({ returned: [], returnedText: "all good" });
  });

  it("only the last model call is the reply, and only when it did not ask for a tool", () => {
    const asksTool = llm("l1", { content: { outputMessages: [{ role: "assistant", content: "", tool_calls: [{ name: "get_weather", args: {} }] }] } });
    const final = llm("l2", { content: { outputMessages: [{ role: "assistant", content: "Done" }] } });
    expect(conversationSteps([node({ children: [asksTool, final] })]).map((s) => s.spanId)).toEqual(["l2"]);
    expect(conversationSteps([node({ children: [final, asksTool] })])).toEqual([]);
    expect(conversationSteps([node({ children: [final] })])[0]).toMatchObject({ kind: "reply", model: "gemini-2.5-flash", tokens: 15, costUsd: 0.001 });
  });
});

describe("fieldsOf", () => {
  it("returns null for anything that is not a JSON object and caps long values and long objects", () => {
    expect(fieldsOf("")).toBeNull();
    expect(fieldsOf("plain")).toBeNull();
    expect(fieldsOf("[1,2]")).toBeNull();
    const rows = fieldsOf(JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k_${i}`, "x".repeat(300)]))))!;
    expect(rows).toHaveLength(8);
    expect(rows[0]!.value.length).toBeLessThanOrEqual(160);
    expect(rows[0]!.key).toBe("k 0");
  });
});
