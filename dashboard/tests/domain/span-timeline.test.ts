import { describe, expect, it } from "vitest";
import { buildTimeline, stepGroup } from "@/domain/span-timeline";
import { node } from "../fakes";

const turn = () => {
  const regex = node({ spanId: "re", name: "guardrail.regex_pii", kind: "guardrail.regex_pii", offsetMs: 0, durationMs: 20 });
  const topic = node({ spanId: "tp", name: "guardrail.topic", kind: "guardrail.topic", offsetMs: 20, durationMs: 150 });
  const guard = node({ spanId: "g1", name: "input_guardrail", kind: "chain", offsetMs: 0, durationMs: 170, children: [regex, topic] });
  const plan = node({ spanId: "l1", name: "chat", kind: "llm", offsetMs: 170, durationMs: 430 });
  const tool = node({ spanId: "t1", name: "execute_tool", kind: "tool", offsetMs: 600, durationMs: 290, genAi: { toolName: "get_forecast" } as never });
  const agent = node({ spanId: "ag", name: "agent run", kind: "agent", offsetMs: 0, durationMs: 1400, children: [guard, plan, tool] });
  return [node({ spanId: "root", name: "turn", kind: "chain", offsetMs: 0, durationMs: 1400, children: [agent] })];
};

describe("buildTimeline", () => {
  it("looks through wrappers and keeps a guardrail as one sequential step", () => {
    const t = buildTimeline(turn(), 1400);
    expect(t.phases.map((p) => [p.node.spanId, p.group])).toEqual([["g1", "guardrail"], ["l1", "llm"], ["t1", "tool"]]);
    expect(t.phases[2]!.label).toBe("get_forecast");
  });

  it("lists what ran inside each step right after it, one level deep", () => {
    const t = buildTimeline(turn(), 1400);
    expect(t.rows.map((r) => [r.node.spanId, r.depth])).toEqual([["g1", 0], ["re", 1], ["tp", 1], ["l1", 0], ["t1", 0]]);
    expect(t.rows[1]!.label).toBe("regex_pii");
  });

  it("places bars as a share of the whole turn and finds the slowest step", () => {
    const t = buildTimeline(turn(), 1400);
    expect(t.phases[1]).toMatchObject({ leftPct: (170 / 1400) * 100, widthPct: (430 / 1400) * 100 });
    expect(t.slowest?.node.spanId).toBe("l1");
  });

  it("uses a lone span as its own step and survives a zero-length trace", () => {
    const t = buildTimeline([node({ spanId: "only", durationMs: 0 })], 0);
    expect(t.phases).toHaveLength(1);
    expect(Number.isFinite(t.phases[0]!.leftPct + t.phases[0]!.widthPct)).toBe(true);
  });

  it("classifies guardrails by kind or name", () => {
    expect(stepGroup(node({ kind: "chain", name: "Output_Guardrail" }))).toBe("guardrail");
    expect(stepGroup(node({ kind: "retriever", name: "search" }))).toBe("other");
  });
});
