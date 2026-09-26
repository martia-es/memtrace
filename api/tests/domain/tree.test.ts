import { describe, expect, it } from "vitest";
import { buildSpanTree, buildTraceDetail } from "@/domain/tree";
import { span } from "../helpers";

describe("buildSpanTree", () => {
  it("links children to parents and orders them by start time, then id", () => {
    const root = span({ spanId: "root", startTimeUs: 100 });
    const late = span({ spanId: "b", parentSpanId: "root", startTimeUs: 300 });
    const early = span({ spanId: "z", parentSpanId: "root", startTimeUs: 200 });
    const tieA = span({ spanId: "a", parentSpanId: "root", startTimeUs: 300 });

    const { roots } = buildSpanTree([late, tieA, early, root], 100);

    expect(roots).toHaveLength(1);
    expect(roots[0]!.children.map((c) => c.spanId)).toEqual(["z", "a", "b"]);
    expect(roots[0]!.orphan).toBe(false);
  });

  it("computes offsetMs relative to the trace start", () => {
    const root = span({ spanId: "r", startTimeUs: 5_000 });
    const child = span({ spanId: "c", parentSpanId: "r", startTimeUs: 7_500 });
    const { roots } = buildSpanTree([root, child], 5_000);
    expect(roots[0]!.offsetMs).toBe(0);
    expect(roots[0]!.children[0]!.offsetMs).toBe(2.5);
  });

  it("marks spans whose parent is missing as orphan roots", () => {
    const root = span({ spanId: "r" });
    const orphan = span({ spanId: "o", parentSpanId: "lost" });
    const { roots } = buildSpanTree([root, orphan], 0);
    expect(roots.map((r) => [r.spanId, r.orphan])).toEqual([
      ["r", false],
      ["o", true],
    ]);
  });

  it("deduplicates spans repeated by collector retries (first wins)", () => {
    const first = span({ spanId: "dup", name: "first" });
    const second = { ...first, name: "second" };
    const { nodes } = buildSpanTree([first, second], 0);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("first");
  });

  it("breaks parent cycles instead of dropping the spans", () => {
    const a = span({ spanId: "a", parentSpanId: "b", startTimeUs: 1 });
    const b = span({ spanId: "b", parentSpanId: "a", startTimeUs: 2 });
    const { roots, nodes } = buildSpanTree([a, b], 0);
    expect(nodes).toHaveLength(2);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.spanId).toBe("a");
    expect(roots[0]!.orphan).toBe(true);
    expect(roots[0]!.children[0]!.spanId).toBe("b");
  });

  it("handles very deep chains without overflowing the stack", () => {
    const depth = 50_000;
    const spans = Array.from({ length: depth }, (_, i) =>
      span({ spanId: `n${i}`, parentSpanId: i === 0 ? null : `n${i - 1}`, startTimeUs: i }),
    );
    const { roots, nodes } = buildSpanTree(spans, 0);
    expect(nodes).toHaveLength(depth);
    expect(roots).toHaveLength(1);
  });

  it("extracts genAi, content and kind, keeping only the rest in attributes", () => {
    const s = span({
      attributes: {
        "memtrace.step_type": "llm",
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "openai",
        "gen_ai.usage.input_tokens": "10",
        "gen_ai.response.finish_reasons": '["stop"]',
        "gen_ai.input.messages": '[{"role":"user"}]',
        "gen_ai.conversation.id": "c1",
      },
    });
    const node = buildSpanTree([s], 0).roots[0]!;
    expect(node.kind).toBe("llm");
    expect(node.genAi).toMatchObject({ operation: "chat", provider: "openai", inputTokens: 10, finishReasons: ["stop"] });
    expect(node.content).toEqual({ inputMessages: [{ role: "user" }] });
    expect(node.attributes).toEqual({ "gen_ai.conversation.id": "c1" });
  });
});

describe("buildTraceDetail", () => {
  const llm = (tokens: Record<string, string>, extra = {}) =>
    span({ attributes: { "gen_ai.operation.name": "chat", ...tokens }, ...extra });

  it("aggregates counts, duration and status; root status is not hidden by child errors", () => {
    const root = span({ spanId: "r", startTimeUs: 0, durationMs: 100 });
    const failing = span({ parentSpanId: "r", startTimeUs: 1_000, durationMs: 5, status: { code: "error", message: "boom" } });
    const detail = buildTraceDetail("t1", [root, failing], false);
    expect(detail).toMatchObject({ traceId: "t1", spanCount: 2, errorCount: 1, status: "ok", durationMs: 100, truncated: false });
  });

  it("status is error when the root failed, unset when there is no real root", () => {
    const failedRoot = span({ spanId: "r", status: { code: "error", message: null } });
    expect(buildTraceDetail("t", [failedRoot], false).status).toBe("error");
    const onlyOrphan = span({ parentSpanId: "missing" });
    expect(buildTraceDetail("t", [onlyOrphan], false).status).toBe("unset");
  });

  it("counts tokens only from chat spans, falling back to input + output", () => {
    const root = span({ spanId: "r", attributes: { "gen_ai.operation.name": "invoke_agent", "gen_ai.usage.total_tokens": "999" } });
    const withTotal = llm({ "gen_ai.usage.total_tokens": "30" }, { parentSpanId: "r" });
    const withoutTotal = llm({ "gen_ai.usage.input_tokens": "4", "gen_ai.usage.output_tokens": "6" }, { parentSpanId: "r" });
    expect(buildTraceDetail("t", [root, withTotal, withoutTotal], false).totalTokens).toBe(40);
  });

  it("propagates the truncated flag", () => {
    expect(buildTraceDetail("t", [span()], true).truncated).toBe(true);
  });
});
