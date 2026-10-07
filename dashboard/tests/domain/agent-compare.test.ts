import type { OverviewResponse } from "@contract";
import { describe, expect, it } from "vitest";
import { compareRows, compareVerdict, costPerExecution, formatChange, relativeChange } from "@/domain/agent-compare";

function overview(over: { traces?: number; conversations?: number; errorRate?: number; tokens?: number; cost?: number; p50?: number; p95?: number; p99?: number }): OverviewResponse {
  return {
    range: { from: "2026-10-06T00:00:00Z", to: "2026-10-07T00:00:00Z", bucketSeconds: 3600 },
    totals: {
      traces: over.traces ?? 1000,
      spans: 5000,
      conversations: over.conversations ?? 400,
      errorTraces: 0,
      errorRate: over.errorRate ?? 0.02,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: over.tokens ?? 1_000_000,
      costUsd: over.cost ?? 40,
    },
    latencyMs: { p50: over.p50 ?? 1200, p95: over.p95 ?? 4800, p99: over.p99 ?? 8000 },
    timeseries: [],
    byModel: [],
    byTool: [],
    byTopic: [],
  };
}

describe("agent comparison", () => {
  it("measures the change of B relative to A, with no base when A is zero", () => {
    expect(relativeChange(100, 36)).toBeCloseTo(-0.64);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(0, 5)).toBeNull();
    expect(formatChange(-0.64)).toBe("▼ 64%");
    expect(formatChange(0.194)).toBe("▲ 19%");
    expect(formatChange(0.001)).toBe("≈ 0%");
    expect(formatChange(null)).toBe("–");
  });

  it("treats lower cost, tokens, latency and errors as better, and volume as neutral", () => {
    const rows = compareRows(overview({}), overview({ cost: 14, tokens: 600_000, p50: 900, p99: 9600, errorRate: 0.04, traces: 800 }));
    const tone = Object.fromEntries(rows.map((r) => [r.key, r.tone]));
    expect(tone).toMatchObject({ cost: "better", tokens: "better", p50: "better", p99: "worse", errors: "worse", executions: "neutral", conversations: "neutral" });
  });

  it("ignores changes under the neutral threshold", () => {
    const rows = compareRows(overview({}), overview({ cost: 39, p95: 4900 }));
    expect(rows.find((r) => r.key === "cost")!.tone).toBe("neutral");
    expect(rows.find((r) => r.key === "p95")!.tone).toBe("neutral");
  });

  it("summarises the comparison in a headline and counts", () => {
    const mixed = compareVerdict(compareRows(overview({}), overview({ cost: 14, p50: 900, p95: 3600, errorRate: 0.04 })));
    expect(mixed).toMatchObject({ better: 3, worse: 1, tone: "mixed", headline: "B is cheaper and faster, but failing more often" });

    const same = compareVerdict(compareRows(overview({}), overview({})));
    expect(same).toMatchObject({ better: 0, worse: 0, tone: "flat", headline: "No meaningful difference between A and B" });
  });

  it("gives cost per execution only when there is a price and traffic", () => {
    expect(costPerExecution(overview({ cost: 30, traces: 1000 }))).toBeCloseTo(0.03);
    expect(costPerExecution(overview({ cost: 0 }))).toBeNull();
    expect(costPerExecution(overview({ traces: 0 }))).toBeNull();
  });
});
