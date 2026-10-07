import { describe, expect, it } from "vitest";
import { genAiRows, spanIo } from "@/domain/span-io";
import { mergeLatestSpans } from "@/domain/merge";
import { firstErrorNode } from "@/domain/waterfall";
import { node, spanRow } from "../fakes";

describe("spanIo", () => {
  it("is empty when no content was captured", () => {
    expect(spanIo(node())).toEqual({ input: [], output: [], inputJson: "", outputJson: "" });
  });

  it("turns chat messages into role-labelled blocks and flattens multimodal content", () => {
    const io = spanIo(node({ content: { inputMessages: [{ role: "system", content: "sé breve" }, { role: "human", content: [{ type: "text", text: "hola" }, { type: "image" }] }], outputMessages: [{ role: "assistant", content: "qué tal" }] } }));
    expect(io.input.map((b) => [b.label, b.role, b.text])).toEqual([["system", "system", "sé breve"], ["human", "user", "hola"]]);
    expect(io.output[0]).toMatchObject({ role: "assistant", text: "qué tal" });
    expect(JSON.parse(io.inputJson)).toHaveLength(2);
  });

  it("shows a tool's arguments and result, formatting JSON kept as text", () => {
    const io = spanIo(node({ content: { toolArguments: { origin: "MAD" }, toolResult: '{"ok":true}' } }));
    expect(io.input[0]).toMatchObject({ label: "arguments", structured: true });
    expect(io.input[0]!.text).toContain('"origin": "MAD"');
    expect(io.output[0]).toMatchObject({ label: "result", structured: true, text: '{"ok":true}' });
  });

  it("falls back to the generic input/output, plain text unstructured", () => {
    const io = spanIo(node({ content: { input: "consulta", output: "respuesta" } }));
    expect(io.input[0]).toMatchObject({ label: "input", text: "consulta", structured: false });
    expect(io.output[0]).toMatchObject({ label: "output", text: "respuesta" });
  });

  it("shows a flat object of simple values as one labelled block per key, not as JSON", () => {
    const io = spanIo(node({ content: { input: '{"message":"Where is the branch?","max":3}', output: false } }));
    expect(io.input.map((b) => [b.label, b.text, b.structured])).toEqual([["message", "Where is the branch?", false], ["max", "3", false]]);
    expect(JSON.parse(io.inputJson)).toEqual({ message: "Where is the branch?", max: 3 });
    expect(io.output[0]).toMatchObject({ label: "output", text: "false" });
  });

  it("keeps nested objects as structured JSON", () => {
    const io = spanIo(node({ content: { input: { filters: { city: "Malaga" } } } }));
    expect(io.input).toHaveLength(1);
    expect(io.input[0]).toMatchObject({ label: "input", structured: true });
  });

  it("extracts chat messages from a chain input shaped as {messages: [...]}", () => {
    const io = spanIo(node({ content: { input: { messages: [{ role: "human", content: "hola" }] } } }));
    expect(io.input[0]).toMatchObject({ label: "human", role: "user", text: "hola" });
    expect(spanIo(node({ content: { input: '{"messages":[{"role":"human","content":"hi"}]}' } })).input[0]).toMatchObject({ role: "user", text: "hi" });
  });

  it("keeps non-message arrays as a single block", () => {
    expect(spanIo(node({ content: { inputMessages: [1, 2] } })).input).toHaveLength(1);
  });

  it("parses Google GenAI / Pydantic AI messages with parts structure", () => {
    const io = spanIo(
      node({
        content: {
          inputMessages: [
            {
              role: "user",
              parts: [{ type: "text", content: "tiempo en madrid" }],
            },
          ],
        },
      })
    );
    expect(io.input[0]).toMatchObject({
      label: "user",
      role: "user",
      text: "tiempo en madrid",
    });
  });

  it("extracts full conversation from pydantic_ai.all_messages attribute when present", () => {
    const allMessages = JSON.stringify([
      { role: "user", parts: [{ type: "text", content: "que tiempo hace?" }] },
      { role: "assistant", parts: [{ type: "tool_call", id: "c1", name: "get_weather", arguments: { loc: "Almeria" } }] },
      { role: "user", parts: [{ type: "tool_call_response", id: "c1", name: "get_weather", result: { temp: 24 } }] },
      { role: "assistant", parts: [{ type: "text", content: "Hace 24 grados" }] },
    ]);
    const io = spanIo(node({ attributes: { "pydantic_ai.all_messages": allMessages } }));
    expect(io.input).toHaveLength(1);
    expect(io.input[0]).toMatchObject({ role: "user", text: "que tiempo hace?" });
    expect(io.output[0]).toMatchObject({ role: "assistant" });
    expect(io.output[1]).toMatchObject({ role: "tool", text: '{\n  "temp": 24\n}' });
    expect(io.output[2]).toMatchObject({ role: "assistant", text: "Hace 24 grados" });
  });
});

describe("spanIo ordered conversation", () => {
  it("keeps the real order of a Pydantic AI history (user, assistant, user)", () => {
    const all = JSON.stringify([
      { role: "user", parts: [{ type: "text", content: "Hola" }] },
      { role: "assistant", parts: [{ type: "text", content: "¡Hola!" }] },
      { role: "user", parts: [{ type: "text", content: "¿tiempo?" }] },
    ]);
    const io = spanIo(node({ attributes: { "pydantic_ai.all_messages": all } }));
    expect(io.ordered?.map((b) => b.text)).toEqual(["Hola", "¡Hola!", "¿tiempo?"]);
  });
});

describe("genAiRows", () => {
  it("omits the fields that are not present", () => {
    expect(genAiRows(node())).toEqual([]);
    const rows = genAiRows(node({ genAi: { operation: "chat", provider: null, requestModel: "m", responseModel: null, inputTokens: 3, outputTokens: null, totalTokens: null, finishReasons: ["stop"], temperature: null, maxTokens: null, toolName: null, toolCallId: null } }));
    expect(rows).toEqual([["Operation", "chat"], ["Request model", "m"], ["Input tokens", "3"], ["Finish reason", "stop"]]);
  });
});

describe("firstErrorNode", () => {
  const err = { code: "error" as const, message: null };
  it("finds the first failed span depth-first, or null", () => {
    const tree = [node({ spanId: "r", children: [node({ spanId: "a", children: [node({ spanId: "a1", status: err })] }), node({ spanId: "b", status: err })] })];
    expect(firstErrorNode(tree)?.spanId).toBe("a1");
    expect(firstErrorNode([node()])).toBeNull();
  });
});

describe("mergeLatestSpans", () => {
  it("keeps what was loaded and marks new spans", () => {
    const at = (id: string, iso: string) => spanRow({ spanId: id.padEnd(16, "0"), startTime: iso });
    const merged = mergeLatestSpans([at("b", "2026-01-01T10:01:00Z"), at("a", "2026-01-01T10:00:00Z")], null, { items: [at("c", "2026-01-01T10:02:00Z")], nextCursor: null });
    expect(merged.items.map((s) => s.spanId[0])).toEqual(["c"]);
    expect(merged.newKeys).toEqual(["c".padEnd(16, "0")]);
  });
});

describe("spanIo tool calls", () => {
  it("keeps an empty AI message that only requests tools, with the calls and their arguments", () => {
    const io = spanIo(node({ content: { outputMessages: [{ role: "ai", content: "", tool_calls: [{ name: "search", id: "call_1", args: { query: "weather" } }] }] } }));
    expect(io.output).toHaveLength(1);
    expect(io.output[0]).toMatchObject({ role: "assistant", hideText: true, calls: [{ name: "search", id: "call_1", args: { query: "weather" } }] });
  });

  it("accepts OpenAI-style function calls with JSON-string arguments", () => {
    const io = spanIo(node({ content: { outputMessages: [{ role: "assistant", content: "voy", tool_calls: [{ id: "c", function: { name: "f", arguments: '{"a":1}' } }] }] } }));
    expect(io.output[0]).toMatchObject({ hideText: false, text: "voy", calls: [{ name: "f", args: { a: 1 } }] });
  });
});
