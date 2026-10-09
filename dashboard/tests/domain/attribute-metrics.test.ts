import { describe, expect, it } from "vitest";
import { isMeasure, type AttributeInfo } from "@/domain/attribute-visibility";
import { ATTRIBUTE_METRICS, NO_NAMES, attributeLabel, buildNames, describeChange, describeDefinition, findOutlier, formatMetricValue, isAttributeMetric, metricColumnLabel, singleNumber, suggestName } from "@/domain/custom-chart-vocabulary";

const def = (metric: "sum_attribute" | "avg_attribute" | "min_attribute" | "max_attribute" | "count", metricAttribute: string | null, over = {}) => ({
  chartType: "line" as const,
  stepTypes: ["tool"],
  metric,
  metricAttribute,
  groupByAttribute: null,
  filters: [],
  ...over,
});

describe("metrics over a numeric attribute (ADR-078, phase 3)", () => {
  it("knows which metrics measure a number", () => {
    expect(ATTRIBUTE_METRICS).toEqual(["sum_attribute", "avg_attribute", "min_attribute", "max_attribute"]);
    expect(isAttributeMetric("sum_attribute")).toBe(true);
    expect(isAttributeMetric("count")).toBe(false);
    expect(isAttributeMetric("error_rate")).toBe(false);
  });

  it("shows a business figure as a plain number, with up to two decimals and no unit", () => {
    expect(formatMetricValue("sum_attribute", 12345.678)).toBe((12345.68).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    expect(formatMetricValue("avg_attribute", 4.2)).toBe((4.2).toLocaleString());
    expect(formatMetricValue("max_attribute", 7)).toBe("7");
    // lo de siempre no cambia
    expect(formatMetricValue("error_rate", 0.123)).toBe("12.3%");
    expect(formatMetricValue("avg_duration", 1500)).toBe("1.5 s");
  });

  it("the single number adds totals, takes the lowest or highest, and averages the rest", () => {
    const points = [{ value: 4 }, { value: 10 }, { value: 1 }];
    expect(singleNumber("sum_attribute", points)).toBe(15);
    expect(singleNumber("count", points)).toBe(15);
    expect(singleNumber("min_attribute", points)).toBe(1);
    expect(singleNumber("max_attribute", points)).toBe(10);
    expect(singleNumber("avg_attribute", points)).toBe(5);
    expect(singleNumber("avg_duration", points)).toBe(5);
    expect(singleNumber("max_attribute", [])).toBe(0);
  });

  it("a business figure going up is neither good nor bad, and nothing stands out as slower or failing", () => {
    expect(describeChange("sum_attribute", 150, 100)).toMatchObject({ direction: "up", tone: "neutral" });
    expect(describeChange("avg_attribute", 50, 100)).toMatchObject({ direction: "down", tone: "neutral" });
    expect(describeChange("avg_duration", 150, 100)).toMatchObject({ tone: "bad" }); // un tiempo que sube sí es malo
    const rows = [{ label: "a", value: 100 }, { label: "b", value: 10 }, { label: "c", value: 10 }];
    expect(findOutlier("sum_attribute", rows)).toBeNull();
    expect(findOutlier("avg_duration", rows)).not.toBeNull();
  });

  it("names the chart and describes it with the number it measures", () => {
    const names = buildNames([{ kind: "attribute", key: "order_total", displayName: "Order value" }]);
    expect(suggestName(def("sum_attribute", "order_total"))).toBe("Total of order total in tool calls");
    expect(suggestName(def("avg_attribute", "rating", { groupByAttribute: "city" }))).toBe("Average rating in tool calls by city");
    expect(suggestName(def("max_attribute", "order_total"), names)).toBe("Highest order value in tool calls");
    expect(describeDefinition(def("sum_attribute", "order_total"))).toBe("Shows the total of order total in tool calls over time.");
    expect(describeDefinition(def("min_attribute", "order_total", { chartType: "number" }), names)).toBe("Shows the lowest order value in tool calls as a single number.");
    // sin atributo elegido todavía, o con una métrica de siempre, nada cambia
    expect(suggestName(def("count", null))).toBe("Count of tool calls");
    expect(describeDefinition(def("count", null))).toBe("Shows the number of tool calls over time.");
  });

  it("labels the value column with the number it measures", () => {
    expect(metricColumnLabel(def("sum_attribute", "order_total"))).toBe("Total of order total");
    expect(metricColumnLabel(def("avg_attribute", "gen_ai.usage.input_tokens"))).toBe("Average input tokens");
    expect(metricColumnLabel(def("max_attribute", "order_total"), buildNames([{ kind: "attribute", key: "order_total", displayName: "Order value" }]))).toBe("Highest order value");
    expect(metricColumnLabel(def("count", null))).toBe("How many times");
    expect(metricColumnLabel(def("sum_attribute", null))).toBe("Total of a number");
  });

  it("gives the token counts a readable name", () => {
    expect(attributeLabel("gen_ai.usage.input_tokens", NO_NAMES)).toBe("Input tokens");
    expect(attributeLabel("gen_ai.usage.output_tokens")).toBe("Output tokens");
    expect(attributeLabel("gen_ai.usage.total_tokens")).toBe("Total tokens");
  });
});

describe("which attributes can be measured", () => {
  const info = (over: Partial<AttributeInfo>): AttributeInfo => ({ key: "k", count: 10, kind: "number", distinct: 50, numeric: true, hiddenByDefault: false, ...over });

  it("numbers and numeric categories can; identifiers and non-numeric ones cannot", () => {
    expect(isMeasure(info({ key: "order_total" }))).toBe(true);
    expect(isMeasure(info({ key: "rating", kind: "category", distinct: 5 }))).toBe(true);
    expect(isMeasure(info({ key: "customer_id", kind: "id", hiddenByDefault: true }))).toBe(false);
    expect(isMeasure(info({ key: "city", kind: "category", numeric: false }))).toBe(false);
  });

  it("technical numbers, such as token counts, can be measured even though they are hidden from the selectors", () => {
    expect(isMeasure(info({ key: "gen_ai.usage.input_tokens", kind: "technical", hiddenByDefault: true }))).toBe(true);
  });

  it("an API that sends no classification offers nothing to measure", () => {
    expect(isMeasure({ key: "order_total", count: 10 })).toBe(false);
  });
});
