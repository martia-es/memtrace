import { describe, expect, it } from "vitest";
import { marginLabel, verdictExplanation, verdictLabel, verdictTone, type EvaluatorNoiseComparison } from "@/ui/noise-verdict";

const c = (over: Partial<EvaluatorNoiseComparison> = {}): EvaluatorNoiseComparison => ({
  name: "acc", dataType: "boolean", baseline: 0.86, candidate: 0.9, delta: 0.04, margin: 0.02, noise: 0.01, verdict: "above", reason: null, ...over,
});

describe("noise verdict labels", () => {
  it("names the three verdicts", () => {
    expect(verdictLabel(c())).toBe("Above noise");
    expect(verdictLabel(c({ verdict: "within" }))).toBe("Within noise");
    expect(verdictLabel(c({ verdict: "not_measured", reason: "no_repetitions", margin: null }))).toBe("Not measured");
  });
  it("only colours a change that is above noise, in the direction it moved", () => {
    expect(verdictTone(c())).toBe("ok");
    expect(verdictTone(c({ delta: -0.04 }))).toBe("error");
    expect(verdictTone(c({ verdict: "within" }))).toBe("neutral");
    expect(verdictTone(c({ verdict: "not_measured", reason: "judge_changed", margin: null }))).toBe("neutral");
  });
  it("shows the margin in points for rates and plainly for averages", () => {
    expect(marginLabel(c({ margin: 0.0462 }))).toBe("±4.6 pp");
    expect(marginLabel(c({ dataType: "numeric", margin: 0.3 }))).toBe("±0.30");
    expect(marginLabel(c({ margin: null }))).toBeNull();
  });
  it("explains why nothing was measured", () => {
    expect(verdictExplanation(c({ verdict: "not_measured", reason: "judge_changed", margin: null }))).toMatch(/judge changed/);
    expect(verdictExplanation(c({ verdict: "not_measured", reason: "no_repetitions", margin: null }))).toMatch(/repeats=3/);
    expect(verdictExplanation(c({ verdict: "within" }))).toMatch(/opposite sign/);
  });
});
