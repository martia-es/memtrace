import { describe, expect, it } from "vitest";
import { ATTRIBUTE_METRICS, isAttributeMetric, summarizeSeries } from "@/domain/metrics";

const series = [
  { points: [{ label: "a", value: 10 }, { label: "b", value: 1 }] },
  { points: [{ label: "a", value: 30 }] },
  { points: [{ label: "a", value: 20 }, { label: "b", value: 3 }] },
];
const byLabel = (rows: Array<{ label: string; value: number }>) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

describe("metrics over a numeric attribute (ADR-078, phase 3)", () => {
  it("knows which metrics need an attribute", () => {
    expect([...ATTRIBUTE_METRICS]).toEqual(["sum_attribute", "avg_attribute", "min_attribute", "max_attribute"]);
    for (const m of ATTRIBUTE_METRICS) expect(isAttributeMetric(m)).toBe(true);
    for (const m of ["count", "avg_duration", "p50_duration", "p95_duration", "error_rate"] as const) expect(isAttributeMetric(m)).toBe(false);
  });
});

describe("summarizeSeries: one figure per label out of a time series (report email)", () => {
  it("adds up what is additive: counts and totals", () => {
    expect(byLabel(summarizeSeries(series, "count"))).toEqual({ a: 60, b: 4 });
    expect(byLabel(summarizeSeries(series, "sum_attribute"))).toEqual({ a: 60, b: 4 });
  });

  it("takes the lowest and the highest, not their sum", () => {
    expect(byLabel(summarizeSeries(series, "min_attribute"))).toEqual({ a: 10, b: 1 });
    expect(byLabel(summarizeSeries(series, "max_attribute"))).toEqual({ a: 30, b: 3 });
  });

  it("averages averages, percentiles and rates instead of adding them up", () => {
    expect(byLabel(summarizeSeries(series, "avg_attribute"))).toEqual({ a: 20, b: 2 });
    expect(byLabel(summarizeSeries(series, "avg_duration"))).toEqual({ a: 20, b: 2 });
    expect(byLabel(summarizeSeries(series, "p95_duration"))).toEqual({ a: 20, b: 2 });
    // un 5 % de fallos cada día no es un 15 % al cabo de tres días
    const daily = [{ points: [{ label: "x", value: 0.05 }] }, { points: [{ label: "x", value: 0.05 }] }, { points: [{ label: "x", value: 0.05 }] }];
    expect(summarizeSeries(daily, "error_rate")[0]!.value).toBeCloseTo(0.05);
  });

  it("an empty series gives no rows", () => {
    expect(summarizeSeries([], "sum_attribute")).toEqual([]);
  });
});
