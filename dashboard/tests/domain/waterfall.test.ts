import { describe, expect, it } from "vitest";
import { ancestorIds, axisTicks, buildRows, findNode, parentIds } from "@/domain/waterfall";
import { node } from "../fakes";

const tree = () => {
  const leaf1 = node({ spanId: "l1", parentSpanId: "mid", offsetMs: 20, durationMs: 10 });
  const mid = node({ spanId: "mid", parentSpanId: "root", offsetMs: 10, durationMs: 40, children: [leaf1] });
  const leaf2 = node({ spanId: "l2", parentSpanId: "root", offsetMs: 60, durationMs: 40 });
  const root = node({ spanId: "root", offsetMs: 0, durationMs: 100, children: [mid, leaf2] });
  return [root];
};

describe("buildRows", () => {
  it("flattens depth-first with depth and bar geometry", () => {
    const rows = buildRows(tree(), 100, new Set());
    expect(rows.map((r) => [r.node.spanId, r.depth])).toEqual([["root", 0], ["mid", 1], ["l1", 2], ["l2", 1]]);
    expect(rows[1]).toMatchObject({ leftPct: 10, widthPct: 40, hasChildren: true });
  });

  it("hides the descendants of collapsed spans", () => {
    const rows = buildRows(tree(), 100, new Set(["mid"]));
    expect(rows.map((r) => r.node.spanId)).toEqual(["root", "mid", "l2"]);
    expect(rows[1]!.collapsed).toBe(true);
  });

  it("keeps very short bars visible and inside the lane", () => {
    const rows = buildRows([node({ offsetMs: 99.99, durationMs: 0.001 })], 100, new Set());
    expect(rows[0]!.widthPct).toBeGreaterThanOrEqual(0.4);
    expect(rows[0]!.leftPct + rows[0]!.widthPct).toBeLessThanOrEqual(100);
  });

  it("does not divide by zero for zero-length traces", () => {
    const rows = buildRows([node({ durationMs: 0 })], 0, new Set());
    expect(Number.isFinite(rows[0]!.leftPct + rows[0]!.widthPct)).toBe(true);
  });

  it("handles very deep chains without recursion", () => {
    let current = node({ spanId: "n0" });
    for (let i = 1; i < 20_000; i++) current = node({ spanId: `n${i}`, children: [current] });
    expect(buildRows([current], 100, new Set())).toHaveLength(20_000);
  });
});

describe("tree helpers", () => {
  it("finds nodes, parents and ancestors", () => {
    expect(findNode(tree(), "l1")?.spanId).toBe("l1");
    expect(findNode(tree(), "nope")).toBeNull();
    expect(parentIds(tree()).sort()).toEqual(["mid", "root"]);
    expect(ancestorIds(tree(), "l1")).toEqual(["mid", "root"]);
    expect(ancestorIds(tree(), "root")).toEqual([]);
  });
  it("builds evenly spaced axis ticks", () => {
    expect(axisTicks(100, 4).map((t) => t.ms)).toEqual([0, 25, 50, 75, 100]);
  });
});
