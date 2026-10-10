import { describe, expect, it, vi } from "vitest";
import { TraceAlertMetricSource } from "@/application/alert-metric-source";
import { validateAlertRule, type AlertRule } from "@/domain/alert";

const NOW = new Date("2026-10-10T10:07:42.500Z");
const CHART = "11111111-1111-4111-8111-111111111111";

const rule = (over: Record<string, unknown> = {}): AlertRule => ({
  ...validateAlertRule({ name: "r", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: [], ...over }),
  id: "r1",
  experimentId: "exp1",
  createdAt: "",
  updatedAt: "",
});

function setup(opts: { totals?: Partial<{ traces: number; errorRate: number; costUsd: number }>; p95?: number; satisfaction?: { satisfaction: number | null; total: number }; points?: Array<{ label: string; value: number }>; chart?: Record<string, unknown> | null } = {}) {
  const getOverview = vi.fn(async () => ({
    totals: { traces: 200, errorRate: 0.0625, costUsd: 3.2, ...opts.totals },
    latencyMs: { p50: 100, p95: opts.p95 ?? 1800, p99: 3000 },
  }));
  const getCustomMetric = vi.fn(async () => ({ points: opts.points ?? [], timeseries: [] }));
  const summarize = vi.fn(async () => ({ total: 40, up: 30, down: 10, satisfaction: 75, ratedTraces: 40, ...opts.satisfaction }));
  const customDefinition = vi.fn(async () => (opts.chart === undefined ? { chartType: "number", stepTypes: ["guardrail"], metric: "count", metricAttribute: null, filters: [], groupByAttribute: null } : opts.chart));
  const source = new TraceAlertMetricSource({ getOverview, getCustomMetric } as never, { summarize }, customDefinition);
  return { source, getOverview, getCustomMetric, summarize, customDefinition };
}

describe("TraceAlertMetricSource (ADR-086)", () => {
  it("error rate is a percentage, with the number of traces as the sample size", async () => {
    const { source } = setup();
    expect(await source.measure(rule(), "weather", NOW)).toEqual({ value: 6.25, samples: 200 });
  });

  it("with no traces there is no error rate, not a zero", async () => {
    const { source } = setup({ totals: { traces: 0, errorRate: 0 } });
    expect(await source.measure(rule(), "weather", NOW)).toEqual({ value: null, samples: 0 });
  });

  it("latency is the p95 in milliseconds", async () => {
    const { source } = setup({ p95: 2345 });
    expect(await source.measure(rule({ metric: "latency_p95", threshold: 2000 }), "weather", NOW)).toEqual({ value: 2345, samples: 200 });
  });

  it("cost needs no minimum of samples and a zero is a real value", async () => {
    const { source } = setup({ totals: { costUsd: 0 } });
    expect(await source.measure(rule({ metric: "cost", threshold: 10 }), "weather", NOW)).toEqual({ value: 0, samples: 0 });
  });

  it("satisfaction is a percentage over the votes of the window, and null without votes", async () => {
    expect(await setup().source.measure(rule({ metric: "satisfaction", comparator: "below", threshold: 70 }), "weather", NOW)).toEqual({ value: 75, samples: 40 });
    const none = setup({ satisfaction: { satisfaction: null, total: 0 } });
    expect(await none.source.measure(rule({ metric: "satisfaction", comparator: "below", threshold: 70 }), "weather", NOW)).toEqual({ value: null, samples: 0 });
  });

  it("measures the window that ends at the start of the current minute", async () => {
    const { source, getOverview } = setup();
    await source.measure(rule({ windowMinutes: 30 }), "weather", NOW);
    const call = (getOverview.mock.calls as unknown as Array<[{ from: Date; to: Date; service: string }]>)[0]![0];
    expect(call.to.toISOString()).toBe("2026-10-10T10:07:00.000Z");
    expect(call.from.toISOString()).toBe("2026-10-10T09:37:00.000Z");
    expect(call.service).toBe("weather");
  });

  it("asks once per service and window, however many rules need it, and forgets on reset", async () => {
    const { source, getOverview } = setup();
    await source.measure(rule(), "weather", NOW);
    await source.measure(rule({ metric: "latency_p95", threshold: 1 }), "weather", NOW);
    await source.measure(rule({ metric: "cost", threshold: 1 }), "weather", NOW);
    expect(getOverview).toHaveBeenCalledTimes(1);
    await source.measure(rule({ windowMinutes: 60 }), "weather", NOW); // otra ventana
    await source.measure(rule(), "other", NOW); // otro servicio
    expect(getOverview).toHaveBeenCalledTimes(3);
    source.reset();
    await source.measure(rule(), "weather", NOW);
    expect(getOverview).toHaveBeenCalledTimes(4);
  });

  describe("custom chart rules", () => {
    const custom = (over: Record<string, unknown> = {}) => rule({ metric: "custom", customMetricId: CHART, threshold: 3, ...over });

    it("reads the single number of the saved chart, as one bar and with no split", async () => {
      const { source, getCustomMetric } = setup({ points: [{ label: "guardrail", value: 7 }] });
      expect(await source.measure(custom(), "weather", NOW)).toEqual({ value: 7, samples: 0 });
      expect(getCustomMetric).toHaveBeenCalledWith(expect.objectContaining({ chartType: "bar", groupByAttribute: null, service: "weather" }));
    });

    it("a count with no spans is a real zero (nothing happened)", async () => {
      expect(await setup({ points: [] }).source.measure(custom(), "weather", NOW)).toEqual({ value: 0, samples: 0 });
    });

    it("any other metric with no spans has no value", async () => {
      const chart = { chartType: "number", stepTypes: ["guardrail"], metric: "avg_duration", metricAttribute: null, filters: [], groupByAttribute: null };
      expect(await setup({ points: [], chart }).source.measure(custom(), "weather", NOW)).toEqual({ value: null, samples: 0 });
    });

    it("a rule whose chart was deleted has no value, instead of failing", async () => {
      expect(await setup().source.measure(custom({ customMetricId: CHART }) as AlertRule, "weather", NOW)).toBeDefined();
      const gone = setup({ chart: null });
      expect(await gone.source.measure(custom(), "weather", NOW)).toEqual({ value: null, samples: 0 });
      const detached = { ...custom(), customMetricId: null } as AlertRule;
      expect(await setup().source.measure(detached, "weather", NOW)).toEqual({ value: null, samples: 0 });
    });
  });

  it("the cost of a period is the estimated cost of that period, and zero for an empty one", async () => {
    const { source, getOverview } = setup({ totals: { costUsd: 12.5 } });
    expect(await source.cost("weather", new Date("2026-10-10T00:00:00Z"), new Date("2026-10-10T10:00:00Z"))).toBe(12.5);
    expect(await source.cost("weather", NOW, NOW)).toBe(0);
    expect(getOverview).toHaveBeenCalledTimes(1);
  });
});
