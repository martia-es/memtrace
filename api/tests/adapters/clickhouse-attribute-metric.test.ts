import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ValidationError } from "@/domain/errors";
import type { CustomMetricQuery } from "@/domain/metrics";

function fakeClient(rows: unknown[] = []) {
  const seen: { query: string; query_params: Record<string, unknown> }[] = [];
  const client = {
    query: async (args: { query: string; query_params: Record<string, unknown> }) => {
      seen.push(args);
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, seen };
}

const q = (over: Partial<CustomMetricQuery> = {}): CustomMetricQuery => ({
  fromMs: 1_700_000_000_000,
  toMs: 1_700_086_400_000,
  scope: { experimentId: "exp-1", serviceName: "weather" },
  chartType: "bar",
  stepTypes: ["tool"],
  metric: "sum_attribute",
  metricAttribute: "order_total",
  groupByAttribute: null,
  filters: [],
  ...over,
});

describe("ClickHouseTraceRepository.getCustomMetric over a numeric attribute (ADR-078, phase 3)", () => {
  it.each([
    ["sum_attribute", "sum"],
    ["avg_attribute", "avg"],
    ["min_attribute", "min"],
    ["max_attribute", "max"],
  ] as const)("%s aggregates the attribute with %s and keeps only finite numbers", async (metric, fn) => {
    const { client, seen } = fakeClient();
    await new ClickHouseTraceRepository(client).getCustomMetric(q({ metric }));
    const { query, query_params } = seen[0]!;
    expect(query).toContain(`${fn}(toFloat64OrNull(SpanAttributes[{metricAttr:String}])) AS value`);
    expect(query).toContain("AND isFinite(toFloat64OrNull(SpanAttributes[{metricAttr:String}]))");
    expect(query_params.metricAttr).toBe("order_total");
  });

  it("binds the attribute as a parameter, so what a person types never reaches the SQL", async () => {
    const { client, seen } = fakeClient();
    const hostile = "x'] ) ; DROP TABLE memtrace.otel_traces; --";
    await new ClickHouseTraceRepository(client).getCustomMetric(q({ metricAttribute: hostile, groupByAttribute: "city" }));
    expect(seen[0]!.query).not.toContain("DROP TABLE");
    expect(seen[0]!.query_params.metricAttr).toBe(hostile);
  });

  it("works for a time series too, grouped and filtered", async () => {
    const { client, seen } = fakeClient();
    await new ClickHouseTraceRepository(client).getCustomMetric(q({ chartType: "line", groupByAttribute: "city", filters: [{ attribute: "region", values: ["EU"] }], bucketSeconds: 3600 }));
    const { query } = seen[0]!;
    expect(query).toContain("GROUP BY bucket, label");
    expect(query).toContain("SpanAttributes[{groupBy:String}]");
    expect(query).toContain("isFinite(");
  });

  it("refuses a metric over a number that does not say which one, without asking ClickHouse", async () => {
    const { client, seen } = fakeClient();
    await expect(new ClickHouseTraceRepository(client).getCustomMetric(q({ metricAttribute: null }))).rejects.toBeInstanceOf(ValidationError);
    expect(seen).toHaveLength(0);
  });

  it("leaves the other metrics exactly as they were: no attribute parameter, no numeric filter", async () => {
    const { client, seen } = fakeClient();
    await new ClickHouseTraceRepository(client).getCustomMetric(q({ metric: "avg_duration", metricAttribute: null }));
    expect(seen[0]!.query).toContain("avg(Duration) / 1e6");
    expect(seen[0]!.query).not.toContain("isFinite");
    expect(seen[0]!.query_params).not.toHaveProperty("metricAttr");
  });
});
