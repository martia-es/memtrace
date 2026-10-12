import { describe, expect, it } from "vitest";
import { guardrailGroups, isGuardrailSpan, matchesFilter, traceSummary } from "@/domain/trace-summary";
import { buildRows } from "@/domain/waterfall";
import { node } from "../fakes";

const check = (name: string, over = {}) => node({ spanId: name, name, kind: "chain", ...over });
const tree = () =>
  node({
    spanId: "r", kind: "agent", durationMs: 1000,
    children: [
      node({ spanId: "ig", name: "input_guardrail", children: [check("guardrail.length"), check("guardrail.pii")] }),
      node({ spanId: "l1", kind: "llm", durationMs: 300 }),
      node({ spanId: "t1", kind: "tool", durationMs: 600, status: { code: "error", message: "x" } }),
      node({ spanId: "rt", kind: "retriever", durationMs: 50 }),
    ],
  });

describe("traceSummary", () => {
  it("counts spans by kind, failures and guardrail checks, and finds the slowest real step", () => {
    const s = traceSummary([tree()], 1000);
    expect(s).toMatchObject({ spans: 7, modelCalls: 1, tools: 1, retrievals: 1, errors: 1, guardrails: { total: 2, failed: 0 } });
    expect(s.slowest).toEqual({ spanId: "t1", name: "span", durationMs: 600, share: 0.6 });
  });

  it("counts a guardrail.blocked span as a blocked check, not as a passed one", () => {
    const root = node({ children: [check("guardrail.pii"), check("guardrail.blocked")] });
    expect(traceSummary([root], 10).guardrails).toEqual({ total: 1, failed: 1 });
  });

  it("has no slowest step when nothing ran a model, a tool or a retrieval", () => {
    expect(traceSummary([node()], 10).slowest).toBeNull();
  });
});

describe("guardrail grouping and filters", () => {
  it("recognises guardrail spans by name or kind", () => {
    expect(isGuardrailSpan(check("guardrail.length"))).toBe(true);
    expect(isGuardrailSpan(node({ kind: "guardrail.pii", name: "x" }))).toBe(true);
    expect(isGuardrailSpan(node({ name: "input_guardrail" }))).toBe(false);
  });

  it("groups a span whose children are all guardrail checks, with how many failed", () => {
    expect(guardrailGroups([tree()])).toEqual(new Map([["ig", { total: 2, failed: 0 }]]));
    const failing = node({ spanId: "g", children: [check("guardrail.pii", { status: { code: "error", message: "x" } }), check("guardrail.blocked")] });
    expect(guardrailGroups([failing]).get("g")).toEqual({ total: 1, failed: 2 });
  });

  it("filters spans by kind, guardrail or error", () => {
    const t = tree();
    expect(matchesFilter(t.children[1]!, "llm")).toBe(true);
    expect(matchesFilter(t.children[1]!, "tool")).toBe(false);
    expect(matchesFilter(t.children[2]!, "error")).toBe(true);
    expect(matchesFilter(t.children[0]!.children[0]!, "guardrail")).toBe(true);
  });

  it("turns the waterfall into a flat list when a filter is on", () => {
    const rows = buildRows([tree()], 1000, new Set(), "llm");
    expect(rows.map((r) => [r.node.spanId, r.depth, r.hasChildren])).toEqual([["l1", 0, false]]);
    expect(buildRows([tree()], 1000, new Set(), "guardrail").map((r) => r.node.spanId)).toEqual(["guardrail.length", "guardrail.pii"]);
    expect(buildRows([tree()], 1000, new Set(["ig"])).map((r) => r.node.spanId)).toEqual(["r", "ig", "l1", "t1", "rt"]);
  });
});
