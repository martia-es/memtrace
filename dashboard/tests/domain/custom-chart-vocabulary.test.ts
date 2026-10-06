import { describe, expect, it } from "vitest";
import {
  describeChange,
  describeDefinition,
  findOutlier,
  formatMetricValue,
  previousRange,
  singleNumber,
  stepsPhrase,
  humanize,
  isTechnicalAttribute,
  presentPointLabel,
  stepLabel,
  suggestChartType,
  suggestName,
  templatesFor,
} from "@/domain/custom-chart-vocabulary";

describe("custom chart vocabulary", () => {
  it("humanizes ids and maps built-in steps to business names", () => {
    expect(humanize("input_guardrail")).toBe("Input guardrail");
    expect(humanize("inputGuardrail")).toBe("Input guardrail");
    expect(stepLabel("llm")).toBe("Model calls");
    expect(stepLabel("pii_check")).toBe("Pii check");
  });

  it("hides instrumentation attributes but keeps business ones", () => {
    expect(isTechnicalAttribute("gen_ai.tool.call.arguments")).toBe(true);
    expect(isTechnicalAttribute("memtrace.step_type")).toBe(true);
    expect(isTechnicalAttribute("guardrail.result")).toBe(false);
    expect(isTechnicalAttribute("gen_ai.tool.name")).toBe(false);
  });

  it("suggests a chart type and a name from the definition", () => {
    expect(suggestChartType(null)).toBe("line");
    expect(suggestChartType("gen_ai.tool.name")).toBe("bar");
    expect(suggestName({ metric: "error_rate", stepTypes: ["tool"], groupByAttribute: "gen_ai.tool.name" })).toBe("Failure rate of tool calls by tool");
  });

  it("describes the chart in one sentence", () => {
    const text = describeDefinition({
      chartType: "line",
      stepTypes: ["guardrail"],
      metric: "count",
      groupByAttribute: null,
      filters: [{ attribute: "guardrail.result", values: ["blocked"] }],
    });
    expect(text).toBe("Shows the number of guardrail over time, only when guardrail result is blocked.");
  });

  it("only translates point labels that are step types", () => {
    expect(presentPointLabel("llm", { groupByAttribute: null })).toBe("Model calls");
    expect(presentPointLabel("llm", { groupByAttribute: "gen_ai.request.model" })).toBe("llm");
  });

  it("offers built-in templates only for detected steps, plus questions for custom ones", () => {
    const ids = templatesFor(["llm", "input_guardrail"]).map((t) => t.id);
    expect(ids).toContain("model-calls-over-time");
    expect(ids).not.toContain("tools-usage");
    expect(ids).toContain("custom-count-input_guardrail");
    expect(ids).toContain("custom-fail-input_guardrail");
  });

  it("formats values with their unit and never sums non-count metrics", () => {
    expect(formatMetricValue("error_rate", 0.0123)).toBe("1.2%");
    expect(formatMetricValue("avg_duration", 420.4)).toBe("420 ms");
    expect(formatMetricValue("p95_duration", 2500)).toContain("s");
    expect(formatMetricValue("count", 1234)).toBe((1234).toLocaleString());
    expect(singleNumber("count", [{ value: 2 }, { value: 3 }])).toBe(5);
    expect(singleNumber("error_rate", [{ value: 0.1 }, { value: 0.3 }])).toBeCloseTo(0.2);
    expect(singleNumber("count", [])).toBe(0);
  });
  it("compares with the immediately preceding period of the same length", () => {
    const prev = previousRange({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" });
    expect(prev).toEqual({ from: "2026-09-24T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
  });

  it("describes the change and whether going up is bad", () => {
    expect(describeChange("error_rate", 0.049, 0.026)).toEqual({ label: "▲ +2.3 pts", direction: "up", tone: "bad" });
    expect(describeChange("avg_duration", 800, 1000)).toEqual({ label: "▼ -20%", direction: "down", tone: "good" });
    expect(describeChange("count", 150, 100)).toMatchObject({ direction: "up", tone: "neutral" });
    expect(describeChange("count", 10, 0)).toBeNull();
    expect(describeChange("error_rate", 0.1, 0.1)?.direction).toBe("flat");
  });

  it("flags only a clear outlier in failure rates and times", () => {
    const pts = [
      { label: "refund_lookup", value: 0.114 },
      { label: "search_city", value: 0.03 },
      { label: "get_forecast", value: 0.02 },
      { label: "send_email", value: 0.01 },
    ];
    expect(findOutlier("error_rate", pts)).toEqual({ label: "refund_lookup", text: "fails 5.7× more than the others." });
    expect(findOutlier("avg_duration", pts)?.text).toContain("slower");
    expect(findOutlier("count", pts)).toBeNull();
    expect(findOutlier("error_rate", pts.slice(0, 2))).toBeNull();
    expect(findOutlier("error_rate", pts.map((p) => ({ ...p, value: 0.05 })))).toBeNull();
  });

  it("names several steps in the suggested name and description", () => {
    expect(stepsPhrase(["tool"])).toBe("tool calls");
    expect(stepsPhrase(["input_guardrail", "tool"])).toBe("input guardrail and tool calls");
    expect(stepsPhrase(["llm", "tool", "agent", "retriever"])).toBe("model calls, tool calls and 2 more");
    expect(suggestName({ metric: "count", stepTypes: ["input_guardrail", "tool"], groupByAttribute: null })).toBe("Count of input guardrail and tool calls");
  });
});
