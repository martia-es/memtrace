import { describe, expect, it } from "vitest";
import { compareWithNoise, evaluatorNoise, sampleStdDev, unstableItems, type NoiseSide } from "@/domain/evaluation-noise";
import type { DatasetRunItemResult, ScoreAggregate } from "@/domain/evaluation";

const agg = (name: string, passRate: number | null, over: Partial<ScoreAggregate> = {}): ScoreAggregate => ({
  datasetRunId: "r", name, dataType: "boolean", passRate, average: null, count: 10, judges: [], ...over,
});
const side = (executions: ScoreAggregate[][], over: Partial<NoiseSide> = {}): NoiseSide => ({ datasetId: "ds", versionMajor: 1, versionMinor: 2, executions, ...over });

describe("sampleStdDev", () => {
  it("is the sample standard deviation and needs two values", () => {
    expect(sampleStdDev([1, 0.5, 1])).toBeCloseTo(0.28867513, 6);
    expect(sampleStdDev([0.7, 0.75])).toBeCloseTo(0.0353553, 6);   // |a - b| / sqrt(2) with two executions
    expect(sampleStdDev([1])).toBeNull();
    expect(sampleStdDev([])).toBeNull();
  });
});

describe("evaluatorNoise", () => {
  it("gives each evaluator's value per execution, its mean and noise, and skips categorical ones", () => {
    const out = evaluatorNoise([
      [agg("acc", 0.88), agg("tone", null, { dataType: "categorical" })],
      [agg("acc", 0.92)],
      [agg("acc", 0.9)],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "acc", dataType: "boolean", values: [0.88, 0.92, 0.9] });
    expect(out[0]!.mean).toBeCloseTo(0.9);
    expect(out[0]!.noise).toBeCloseTo(0.02, 6);
  });
  it("uses the average for numeric evaluators and null where an execution has none", () => {
    const [e] = evaluatorNoise([[agg("help", null, { dataType: "numeric", average: 4 })], [], [agg("help", null, { dataType: "numeric", average: 4.2 })]]);
    expect(e!.values).toEqual([4, null, 4.2]);
    expect(e!.mean).toBeCloseTo(4.1);
  });
});

describe("compareWithNoise", () => {
  const A = side([[agg("acc", 0.88)], [agg("acc", 0.9)], [agg("acc", 0.92)]]);   // mean 0.90, sigma 0.02
  const B = (v: number) => side([[agg("acc", v)]]);

  it("calls a difference larger than twice the standard error 'above' noise", () => {
    // se = 0.02 * sqrt(1/3 + 1/1) = 0.0231 → margin 0.0462
    const [c] = compareWithNoise(A, B(0.96));
    expect(c).toMatchObject({ name: "acc", verdict: "above", reason: null });
    expect(c!.delta).toBeCloseTo(0.06);
    expect(c!.margin).toBeCloseTo(0.04619, 4);
  });

  it("calls a smaller one 'within' noise, in either direction", () => {
    expect(compareWithNoise(A, B(0.93))[0]!.verdict).toBe("within");
    expect(compareWithNoise(A, B(0.87))[0]!.verdict).toBe("within");
    expect(compareWithNoise(A, B(0.84))[0]).toMatchObject({ verdict: "above" });   // a regression is above noise too
  });

  it("takes the noise from the candidate when only it has repetitions", () => {
    const [c] = compareWithNoise(B(0.9), A);
    expect(c!.noise).toBeCloseTo(0.02, 6);
    expect(c!.verdict).toBe("within");
  });

  it("combines the noise of both sides when both have repetitions", () => {
    const wide = side([[agg("acc", 0.8)], [agg("acc", 0.9)], [agg("acc", 1.0)]]);   // sigma 0.1
    const [c] = compareWithNoise(A, wide);
    expect(c!.noise).toBeCloseTo(Math.sqrt((2 * 0.02 ** 2 + 2 * 0.1 ** 2) / 4), 6);
  });

  it("does not guess when neither side was repeated", () => {
    expect(compareWithNoise(B(0.9), B(0.95))[0]).toMatchObject({ verdict: "not_measured", reason: "no_repetitions", margin: null });
  });

  it("does not reuse the noise across another dataset version or dataset", () => {
    expect(compareWithNoise(A, side([[agg("acc", 0.96)]], { versionMinor: 3 }))[0]).toMatchObject({ verdict: "not_measured", reason: "dataset_changed" });
    expect(compareWithNoise(A, side([[agg("acc", 0.96)]], { datasetId: "other" }))[0]!.reason).toBe("dataset_changed");
  });

  it("does not reuse the noise when the judge changed (ADR-043)", () => {
    const judged = (model: string, v: number) => agg("tone", v, { judges: [{ model, promptHash: "h" }] });
    const a = side([[judged("gpt-4o", 0.78)], [judged("gpt-4o", 0.8)], [judged("gpt-4o", 0.76)]]);
    expect(compareWithNoise(a, side([[judged("gpt-4o", 0.9)]]))[0]).toMatchObject({ verdict: "above" });
    expect(compareWithNoise(a, side([[judged("gpt-4.1", 0.9)]]))[0]).toMatchObject({ verdict: "not_measured", reason: "judge_changed" });
  });

  it("reports an evaluator that only one side has as having no values", () => {
    const [c] = compareWithNoise(A, side([[agg("other", 0.5)]]));
    expect(compareWithNoise(A, side([[agg("other", 0.5)]])).map((x) => [x.name, x.reason])).toEqual([["acc", "no_values"], ["other", "no_values"]]);
    expect(c!.delta).toBeNull();
  });

  it("treats identical executions as zero noise: any real difference is above, none is within", () => {
    const same = side([[agg("acc", 0.9)], [agg("acc", 0.9)]]);
    expect(compareWithNoise(same, B(0.91))[0]!.verdict).toBe("above");
    expect(compareWithNoise(same, B(0.9))[0]!.verdict).toBe("within");
  });
});

describe("unstableItems", () => {
  const item = (itemIndex: number, input: string, ...scores: Array<[string, string, "boolean" | "numeric"]>): DatasetRunItemResult => ({
    itemIndex, input, expectedOutput: null, output: null, traceId: null, error: null,
    scores: scores.map(([name, value, dataType]) => ({ name, value, dataType, source: "code", comment: null })),
  });

  it("lists the items whose boolean result is not the same in every execution", () => {
    const { counts, items } = unstableItems([
      [item(0, "a", ["acc", "true", "boolean"]), item(1, "b", ["acc", "true", "boolean"])],
      [item(0, "a", ["acc", "false", "boolean"]), item(1, "b", ["acc", "true", "boolean"])],
      [item(0, "a", ["acc", "true", "boolean"]), item(1, "b", ["acc", "true", "boolean"])],
    ]);
    expect(counts).toEqual([{ evaluator: "acc", unstable: 1, total: 2 }]);
    expect(items).toEqual([{ itemIndex: 0, input: "a", evaluator: "acc", outcomes: ["true", "false", "true"] }]);
  });

  it("ignores items that are missing from an execution", () => {
    const { counts } = unstableItems([[item(0, "a", ["acc", "true", "boolean"])], [item(0, "a", ["acc", "false", "boolean"]), item(1, "b", ["acc", "true", "boolean"])]]);
    expect(counts).toEqual([{ evaluator: "acc", unstable: 1, total: 1 }]);
  });

  it("calls a numeric score unstable only when it moves by more than a tenth of its scale", () => {
    const { items } = unstableItems([
      [item(0, "a", ["help", "4.0", "numeric"]), item(1, "b", ["help", "4.0", "numeric"])],
      [item(0, "a", ["help", "4.2", "numeric"]), item(1, "b", ["help", "2.0", "numeric"])],
    ]);
    expect(items.map((i) => i.itemIndex)).toEqual([1]);   // 0.2 of a scale of 4.2 is under 10 %; 2.0 is not
  });

  it("caps the list but keeps the counts exact", () => {
    const many = (v: string) => Array.from({ length: 5 }, (_, i) => item(i, `q${i}`, ["acc", v, "boolean"]));
    const { counts, items } = unstableItems([many("true"), many("false")], 2);
    expect(items).toHaveLength(2);
    expect(counts[0]).toEqual({ evaluator: "acc", unstable: 5, total: 5 });
  });
});
