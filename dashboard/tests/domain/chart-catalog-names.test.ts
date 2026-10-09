import { describe, expect, it } from "vitest";
import { NO_NAMES, attributeLabel, buildNames, describeDefinition, presentPointLabel, stepLabel, stepsPhrase, suggestName, templatesFor } from "@/domain/custom-chart-vocabulary";
import { presentResult } from "@/ui/custom-metric-chart-option";

const names = buildNames([
  { kind: "step", key: "input_guardrail", displayName: "Personal data filter" },
  { kind: "step", key: "tool", displayName: "Tools used" },
  { kind: "attribute", key: "gen_ai.tool.name", displayName: "Which tool" },
  { kind: "attribute", key: "customer_id", displayName: null },
]);

describe("name catalog (ADR-078)", () => {
  it("only entries with an own name rename something", () => {
    expect(names.steps).toEqual({ input_guardrail: "Personal data filter", tool: "Tools used" });
    expect(names.attributes).toEqual({ "gen_ai.tool.name": "Which tool" });
    expect(buildNames([])).toEqual(NO_NAMES);
  });

  it("an edited name wins over the dictionary, which wins over the humanized identifier", () => {
    expect(stepLabel("tool", names)).toBe("Tools used"); // editado > diccionario ("Tool calls")
    expect(stepLabel("tool")).toBe("Tool calls");
    expect(stepLabel("llm", names)).toBe("Model calls"); // sin edición: diccionario
    expect(stepLabel("output_guardrail", names)).toBe("Output guardrail"); // sin nada: humanizado
    expect(stepLabel("input_guardrail", names)).toBe("Personal data filter");
    expect(attributeLabel("gen_ai.tool.name", names)).toBe("Which tool");
    expect(attributeLabel("gen_ai.tool.name")).toBe("Tool");
    expect(attributeLabel("customer_id", names)).toBe("Customer id");
  });

  it("the edited names reach every sentence the builder writes", () => {
    const def = { chartType: "bar" as const, stepTypes: ["input_guardrail"], metric: "count" as const, groupByAttribute: "gen_ai.tool.name", filters: [] };
    expect(stepsPhrase(["input_guardrail", "tool"], names)).toBe("personal data filter and tools used");
    expect(suggestName(def, names)).toBe("Count of personal data filter by which tool");
    expect(describeDefinition(def, names)).toBe("Shows the number of personal data filter for each which tool.");
    expect(describeDefinition({ ...def, filters: [{ attribute: "gen_ai.tool.name", values: ["search"] }] }, names)).toContain("only when which tool is search");
  });

  it("without names everything reads as before", () => {
    const def = { chartType: "bar" as const, stepTypes: ["tool"], metric: "count" as const, groupByAttribute: "gen_ai.tool.name", filters: [] };
    expect(suggestName(def)).toBe("Count of tool calls by tool");
    expect(describeDefinition(def)).toBe(describeDefinition(def, NO_NAMES));
  });

  it("the questions offered for a custom step use its name", () => {
    const questions = templatesFor(["input_guardrail"], names).map((t) => t.question);
    expect(questions).toEqual(['How often does "Personal data filter" happen?', 'How often does "Personal data filter" fail?']);
    expect(templatesFor(["input_guardrail"]).map((t) => t.question)[0]).toBe('How often does "Input guardrail" happen?');
  });

  it("points that are steps show the edited name, points that are attribute values stay as they are", () => {
    expect(presentPointLabel("input_guardrail", { groupByAttribute: null }, names)).toBe("Personal data filter");
    expect(presentPointLabel("search", { groupByAttribute: "gen_ai.tool.name" }, names)).toBe("search");
    const result = presentResult({ points: [{ label: "input_guardrail", value: 3 }], timeseries: [{ bucketStart: "t", points: [{ label: "tool", value: 1 }] }] }, { groupByAttribute: null }, names);
    expect(result.points[0]!.label).toBe("Personal data filter");
    expect(result.timeseries[0]!.points[0]!.label).toBe("Tools used");
  });
});
