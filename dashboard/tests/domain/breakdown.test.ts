import { describe, expect, it } from "vitest";
import type { BreakdownItemDto } from "@contract";
import { breakdownCsv, compareBreakdown, findInsight, sparkPath, trendRates } from "@/domain/breakdown";

const item = (key: string, over: Partial<BreakdownItemDto> = {}): BreakdownItemDto => ({
  key, related: [], traces: 400, errorTraces: 40, errorRate: 0.1, errorMargin: 0.03, p95Ms: 3800, inputTokens: 0, outputTokens: 0,
  costUsd: 5, costPerTraceUsd: 0.0125, costComplete: true, thumbsUpRate: 0.8, ratedTraces: 60, trend: [], ...over,
});

describe("compareBreakdown", () => {
  it("calls an error drop reliable when the 95 % ranges do not overlap", () => {
    const [errors] = compareBreakdown(item("v3", { errorRate: 0.094, errorMargin: 0.028 }), item("v4", { errorRate: 0.018, errorMargin: 0.019 }));
    expect(errors).toMatchObject({ label: "ERRORS", tone: "ok", note: "Ranges do not overlap: reliable" });
    expect(errors!.delta).toBe("−7.6 points");
  });

  it("warns that a difference may be noise when the ranges overlap", () => {
    const [errors] = compareBreakdown(item("a", { errorRate: 0.024, errorMargin: 0.009 }), item("b", { errorRate: 0.016, errorMargin: 0.013 }));
    expect(errors).toMatchObject({ tone: "neutral", note: "Ranges overlap: may be noise" });
  });

  it("does not trust a comparison with too few traces", () => {
    const [errors] = compareBreakdown(item("a", { traces: 5 }), item("b", { errorRate: 0.01, errorMargin: 0.001 }));
    expect(errors).toMatchObject({ tone: "neutral", note: "Too few traces to trust" });
  });

  it("tones latency and cost by direction and says how much", () => {
    const [, latency, cost] = compareBreakdown(item("a", { p95Ms: 3800, costPerTraceUsd: 0.0134 }), item("b", { p95Ms: 2100, costPerTraceUsd: 0.0121 }));
    expect(latency).toMatchObject({ tone: "ok", note: "45 % faster" });
    expect(cost).toMatchObject({ tone: "ok", note: "10 % cheaper" });
    const [, slower, dearer] = compareBreakdown(item("a", { p95Ms: 2000, costPerTraceUsd: 0.004 }), item("b", { p95Ms: 5000, costPerTraceUsd: 0.04 }));
    expect(slower).toMatchObject({ tone: "error", note: "150 % slower" });
    expect(dearer).toMatchObject({ tone: "error", note: "900 % more expensive" });
  });

  it("shows a dash instead of a delta when a price or rating is missing", () => {
    const [, , cost, rating] = compareBreakdown(item("a", { costPerTraceUsd: null }), item("b", { thumbsUpRate: null }));
    expect(cost).toMatchObject({ delta: "–", note: "No price for one of the models" });
    expect(rating).toMatchObject({ delta: "–", note: "Nobody rated one of them" });
  });

  it("leaves the rating neutral when there are few ratings", () => {
    const [, , , rating] = compareBreakdown(item("a", { thumbsUpRate: 0.7, ratedTraces: 4 }), item("b", { thumbsUpRate: 0.9, ratedTraces: 30 }));
    expect(rating).toMatchObject({ tone: "neutral", note: "Few ratings: confirm with more traffic" });
  });
});

describe("findInsight", () => {
  it("finds the worst and best rows only when their ranges do not overlap", () => {
    const worst = item("weather v3", { errorRate: 0.094, errorMargin: 0.028 });
    const best = item("weather v4", { errorRate: 0.018, errorMargin: 0.019 });
    expect(findInsight([best, worst, item("mid", { errorRate: 0.05, errorMargin: 0.02 })])).toEqual({ worst, best });
    expect(findInsight([item("a", { errorRate: 0.05, errorMargin: 0.03 }), item("b", { errorRate: 0.07, errorMargin: 0.03 })])).toBeNull();
  });

  it("ignores rows with too few traces and needs two solid rows", () => {
    expect(findInsight([item("a"), item("b", { traces: 3, errorRate: 0.9, errorMargin: 0.01 })])).toBeNull();
    expect(findInsight([])).toBeNull();
  });
});

describe("sparkline", () => {
  it("turns the daily trend into error rates, zero on quiet days", () => {
    const t = (traces: number, errorTraces: number) => ({ day: "", traces, errorTraces });
    expect(trendRates(item("a", { trend: [t(10, 1), t(0, 0), t(4, 2)] }))).toEqual([0.1, 0, 0.5]);
  });

  it("scales to a shared ceiling and draws nothing for fewer than two points", () => {
    expect(sparkPath([0, 0.1], 0.1, 110, 26)).toBe("M2.0 24.0 L108.0 2.0");
    expect(sparkPath([0.1], 0.1, 110, 26)).toBe("");
  });
});

describe("breakdownCsv", () => {
  it("exports raw figures and quotes the keys that need it", () => {
    const csv = breakdownCsv("prompt_version", [item("weather, v3", { thumbsUpRate: null })]);
    const [head, row] = csv.split("\n");
    expect(head!.startsWith("prompt_version,traces,")).toBe(true);
    expect(row!.startsWith('"weather, v3",400,40,0.1,')).toBe(true);
    expect(row!.endsWith(",true,,60")).toBe(true);
  });
});
