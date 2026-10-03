import { describe, expect, it } from "vitest";
import type { Annotation } from "@/domain/annotation";
import { buildPromotedItem, extractTraceContent, resolveExpectedOutput } from "@/domain/dataset-promotion";
import { span } from "../helpers";

const label = (overrides: Partial<Annotation> = {}): Annotation => ({
  traceId: "t1",
  spanId: null,
  configId: "c1",
  configName: "correct_answer",
  dataType: "categorical",
  annotatorId: "u1",
  value: "Paris",
  comment: null,
  createdAt: "2026-10-03T10:00:00Z",
  ...overrides,
});

describe("extractTraceContent", () => {
  it("takes the input of the first span that has it and the output of the last to finish, parsing JSON", () => {
    const content = extractTraceContent([
      span({ startTimeUs: 100, durationMs: 1, attributes: { "memtrace.input": '{"q":"capital of France?"}' } }),
      span({ startTimeUs: 200, durationMs: 1, attributes: { "memtrace.input": "later input", "memtrace.output": "early" } }),
      span({ startTimeUs: 150, durationMs: 50, attributes: { "memtrace.output": "plain text answer" } }),
    ]);
    expect(content).toEqual({ input: { q: "capital of France?" }, output: "plain text answer" });
  });

  it("falls back to chat messages when there is no memtrace.input", () => {
    const content = extractTraceContent([span({ attributes: { "gen_ai.input.messages": '[{"role":"user","content":"hi"}]' } })]);
    expect(content?.input).toEqual([{ role: "user", content: "hi" }]);
    expect(content?.output).toBeNull();
  });

  it("returns null when no span captured input (content off, or an eval.item span)", () => {
    expect(extractTraceContent([span({ name: "eval.item" })])).toBeNull();
    expect(extractTraceContent([span({ attributes: { "memtrace.output": "only output" } })])).toBeNull();
  });

  it("treats a blank input as no content but keeps text containing a redaction marker", () => {
    expect(extractTraceContent([span({ attributes: { "memtrace.input": "   " } })])).toBeNull();
    expect(extractTraceContent([span({ attributes: { "memtrace.input": "key is [REDACTED]" } })])?.input).toBe("key is [REDACTED]");
  });
});

describe("resolveExpectedOutput", () => {
  it("an explicit expectedOutput wins, even null", () => {
    expect(resolveExpectedOutput({ expectedOutput: "typed", fromConfigId: "c1", annotations: [label()] })).toEqual({ ok: true, value: "typed" });
    expect(resolveExpectedOutput({ expectedOutput: null, fromConfigId: "c1", annotations: [label()] })).toEqual({ ok: true, value: null });
  });

  it("uses the categorical label of fromConfigId when annotators agree", () => {
    const annotations = [label(), label({ annotatorId: "u2" })];
    expect(resolveExpectedOutput({ fromConfigId: "c1", annotations })).toEqual({ ok: true, value: "Paris" });
  });

  it("is ambiguous when annotators disagree", () => {
    const annotations = [label(), label({ annotatorId: "u2", value: "Lyon" })];
    expect(resolveExpectedOutput({ fromConfigId: "c1", annotations })).toEqual({ ok: false, reason: "ambiguous_label" });
  });

  it("rejects numeric and boolean configs: a verdict is not a reference answer", () => {
    expect(resolveExpectedOutput({ fromConfigId: "c1", annotations: [label({ dataType: "boolean", value: "false" })] })).toEqual({ ok: false, reason: "unsupported_label" });
  });

  it("ignores span-level and run-item annotations, and other configs", () => {
    const annotations = [label({ spanId: "s1" }), label({ datasetRunId: "r1", itemIndex: 0 }), label({ configId: "c2" })];
    expect(resolveExpectedOutput({ fromConfigId: "c1", annotations })).toEqual({ ok: true, value: null });
  });

  it("defaults to null without a config", () => {
    expect(resolveExpectedOutput({ annotations: [label()] })).toEqual({ ok: true, value: null });
  });
});

describe("buildPromotedItem", () => {
  it("keeps the observed output out of expectedOutput and snapshots provenance in metadata", () => {
    const item = buildPromotedItem({
      traceId: "t1",
      content: { input: "q", output: "wrong answer" },
      expectedOutput: "Paris",
      annotations: [label(), label({ spanId: "s1" })],
      promotedBy: "u9",
      promotedAt: new Date("2026-10-03T12:00:00Z"),
    });
    expect(item.expectedOutput).toBe("Paris");
    expect(item.metadata.promotedFrom).toEqual({
      traceId: "t1",
      promotedBy: "u9",
      promotedAt: "2026-10-03T12:00:00.000Z",
      observedOutput: "wrong answer",
      annotations: [{ config: "correct_answer", value: "Paris", annotator: "u1" }],
    });
  });
});
