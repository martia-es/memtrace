import { describe, expect, it } from "vitest";
import { PREVIEW_CHARS, previewOf, toSpanRow, type SpanRecord } from "@/domain/span-row";

const record = (over: Partial<SpanRecord> = {}): SpanRecord => ({
  spanId: "s1", traceId: "t1", parentSpanId: null, conversationId: "c1", name: "llm.reason", kind: "llm", serviceName: "svc",
  startTimeUs: 1, durationMs: 5, status: "ok", model: "m", totalTokens: 10, inputRaw: null, outputRaw: null, chat: true, ...over,
});

describe("previewOf", () => {
  it("shows the last user message of a chat input and the last assistant text of its output", () => {
    const input = JSON.stringify([{ role: "system", content: "sé breve" }, { role: "user", content: "hola" }, { role: "assistant", content: "qué tal" }, { role: "user", content: "reserva  un\nvuelo" }]);
    const output = JSON.stringify([{ role: "assistant", content: "hecho" }]);
    expect(previewOf(input, "input", true)).toBe("reserva un vuelo");
    expect(previewOf(output, "output", true)).toBe("hecho");
  });

  it("returns non-chat content as is, whitespace collapsed", () => {
    expect(previewOf('{"origin":"MAD",\n "dest":"LIS"}', "input", false)).toBe('{"origin":"MAD", "dest":"LIS"}');
  });

  it("falls back to the raw text when a chat payload is truncated (invalid JSON)", () => {
    expect(previewOf('[{"role":"user","content":"corta…[truncated]', "input", true)).toContain("truncated");
  });

  it("is null for empty content and caps long content", () => {
    expect(previewOf(null, "input", true)).toBeNull();
    expect(previewOf("   ", "output", false)).toBeNull();
    expect(previewOf("x".repeat(1000), "input", false)).toHaveLength(PREVIEW_CHARS);
  });
});

describe("toSpanRow", () => {
  it("replaces raw content with previews and keeps the rest", () => {
    const row = toSpanRow(record({ inputRaw: JSON.stringify([{ role: "user", content: "hola" }]), chat: true }));
    expect(row).toMatchObject({ spanId: "s1", input: "hola", output: null, totalTokens: 10 });
    expect(row).not.toHaveProperty("inputRaw");
    expect(row).not.toHaveProperty("chat");
  });
});
