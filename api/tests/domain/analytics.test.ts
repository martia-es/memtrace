import { describe, expect, it } from "vitest";
import { buildAnalytics, TREND_DAYS, wilsonMargin, type AnalyticsGroupRow } from "@/domain/analytics";
import { toPricingCatalog } from "@/domain/pricing";

const DAY = 86_400_000;
const range = { fromMs: 0, toMs: 20 * DAY + 5000 };
const pricing = toPricingCatalog([{ modelId: "gpt-4o", provider: "openai", inputPricePerToken: 0.000002, outputPricePerToken: 0.00001, source: "test", updatedAtMs: 0 }]);
const group = (key: string, extra: Partial<AnalyticsGroupRow> = {}): AnalyticsGroupRow => ({ key, traces: 100, errorTraces: 10, p95Ms: 800, related: [], up: 0, down: 0, ...extra });
const empty = { tokens: [], days: [] };

describe("wilsonMargin", () => {
  it("is zero without traces and shrinks as the sample grows", () => {
    expect(wilsonMargin(0, 0)).toBe(0);
    expect(wilsonMargin(10, 100)).toBeGreaterThan(wilsonMargin(100, 1000));
  });
  it("stays above zero when no trace failed, which a normal approximation gets wrong", () => {
    expect(wilsonMargin(0, 50)).toBeGreaterThan(0.02);
  });
});

describe("buildAnalytics", () => {
  it("computes the error rate with its margin and sorts by traces", () => {
    const a = buildAnalytics("prompt_version", { ...empty, groups: [group("summary v2", { traces: 50, errorTraces: 5 }), group("summary v3", { traces: 400, errorTraces: 40 })] }, pricing, range);
    expect(a.items.map((i) => i.key)).toEqual(["summary v3", "summary v2"]);
    expect(a.items[0]!.errorRate).toBeCloseTo(0.1);
    expect(a.items[0]!.errorMargin).toBeLessThan(a.items[1]!.errorMargin);
  });

  it("prices the tokens per model and gives the cost per trace", () => {
    const [i] = buildAnalytics(
      "environment",
      { groups: [group("pro", { traces: 10 })], tokens: [{ key: "pro", model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 100_000 }], days: [] },
      pricing,
      range,
    ).items;
    expect(i!.costUsd).toBeCloseTo(3);
    expect(i!.costPerTraceUsd).toBeCloseTo(0.3);
    expect(i!.costComplete).toBe(true);
  });

  it("marks the cost as a minimum when a model has no price and counts those tokens", () => {
    const a = buildAnalytics(
      "prompt_version",
      { groups: [group("a v1")], tokens: [{ key: "a v1", model: "gpt-4o", inputTokens: 1000, outputTokens: 0 }, { key: "a v1", model: "mystery", inputTokens: 500, outputTokens: 250 }], days: [] },
      pricing,
      range,
    );
    expect(a.items[0]!.costComplete).toBe(false);
    expect(a.items[0]!.costUsd).toBeCloseTo(0.002);
    expect(a.unpricedTokens).toBe(750);
  });

  it("leaves the cost unknown when no model has a price", () => {
    const [i] = buildAnalytics("prompt_version", { groups: [group("a v1")], tokens: [{ key: "a v1", model: null, inputTokens: 10, outputTokens: 10 }], days: [] }, pricing, range).items;
    expect(i!.costUsd).toBeNull();
    expect(i!.costPerTraceUsd).toBeNull();
  });

  it("gives the thumbs-up rate only when someone rated", () => {
    const a = buildAnalytics("environment", { ...empty, groups: [group("pro", { up: 9, down: 1 }), group("pre")] }, pricing, range);
    expect(a.items.find((i) => i.key === "pro")!.thumbsUpRate).toBeCloseTo(0.9);
    expect(a.items.find((i) => i.key === "pre")!.thumbsUpRate).toBeNull();
  });

  it("returns a 7-day trend ending on the last day of the range, filling quiet days with zeros", () => {
    const last = 20 * DAY;
    const [i] = buildAnalytics("environment", { groups: [group("pro")], tokens: [], days: [{ key: "pro", dayMs: last, traces: 30, errorTraces: 3 }, { key: "pro", dayMs: last - 2 * DAY, traces: 10, errorTraces: 0 }] }, pricing, range).items;
    expect(i!.trend).toHaveLength(TREND_DAYS);
    expect(i!.trend.at(-1)).toEqual({ dayMs: last, traces: 30, errorTraces: 3 });
    expect(i!.trend[TREND_DAYS - 3]!.traces).toBe(10);
    expect(i!.trend[0]!.traces).toBe(0);
  });
});
