import { describe, expect, it } from "vitest";
import { toSavedCustomMetricDto } from "@/adapters/inbound/http/mappers";
import { customMetricDefinitionBody, customMetricQueryBody, saveCustomMetricBody } from "@/adapters/inbound/http/schemas";

const base = { chartType: "bar", stepTypes: ["tool"], groupByAttribute: null, filters: [] };

describe("custom metric definition body (ADR-077, phase 3)", () => {
  it("an old definition, with no metricAttribute, still parses and reads as null", () => {
    const parsed = customMetricDefinitionBody.parse({ ...base, metric: "count" });
    expect(parsed.metricAttribute).toBeNull();
  });

  it("a metric over a number carries the attribute it measures", () => {
    for (const metric of ["sum_attribute", "avg_attribute", "min_attribute", "max_attribute"]) {
      expect(customMetricDefinitionBody.parse({ ...base, metric, metricAttribute: "order_total" })).toMatchObject({ metric, metricAttribute: "order_total" });
    }
  });

  it("refuses a metric over a number that does not say which one", () => {
    const result = customMetricDefinitionBody.safeParse({ ...base, metric: "sum_attribute" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["metricAttribute"], message: "Pick the number to measure" });
    expect(customMetricDefinitionBody.safeParse({ ...base, metric: "avg_attribute", metricAttribute: "" }).success).toBe(false);
  });

  it("refuses an attribute on a metric that does not use one, so a definition never says one thing and measures another", () => {
    const result = customMetricDefinitionBody.safeParse({ ...base, metric: "count", metricAttribute: "order_total" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["metricAttribute"] });
  });

  it("refuses an unknown metric, as before", () => {
    expect(customMetricDefinitionBody.safeParse({ ...base, metric: "sum(Duration); DROP TABLE x" }).success).toBe(false);
  });

  it("the same rule holds for a query and for saving a chart", () => {
    const range = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" };
    expect(customMetricQueryBody.safeParse({ ...range, ...base, metric: "max_attribute", metricAttribute: "rating" }).success).toBe(true);
    expect(customMetricQueryBody.safeParse({ ...range, ...base, metric: "max_attribute" }).success).toBe(false);
    expect(saveCustomMetricBody.safeParse({ name: "Top order", definition: { ...base, metric: "max_attribute", metricAttribute: "order_total" } }).success).toBe(true);
    expect(saveCustomMetricBody.safeParse({ name: "Top order", definition: { ...base, metric: "max_attribute" } }).success).toBe(false);
  });
});

describe("saved charts read back", () => {
  it("a chart saved before the metrics over a number reads with metricAttribute null", () => {
    const old = { id: "m1", name: "Tool calls", definition: { chartType: "bar", stepTypes: ["tool"], metric: "count", groupByAttribute: null, filters: [] }, createdAt: "t" };
    expect(toSavedCustomMetricDto(old as never).definition.metricAttribute).toBeNull();
  });

  it("keeps the attribute of a chart that has one", () => {
    const saved = { id: "m2", name: "Revenue", definition: { chartType: "line", stepTypes: ["tool"], metric: "sum_attribute", metricAttribute: "order_total", groupByAttribute: null, filters: [] }, createdAt: "t" };
    expect(toSavedCustomMetricDto(saved as never).definition).toMatchObject({ metric: "sum_attribute", metricAttribute: "order_total" });
  });
});
