import { describe, expect, it } from "vitest";
import { matchesTarget, runScore } from "@/domain/alert-evaluation";
import type { DatasetRunItemResult } from "@/domain/evaluation";

const bool = (name: string, ok: boolean) => ({ name, value: String(ok), dataType: "boolean" as const, source: "code" as const, comment: null });
const num = (name: string, value: number) => ({ name, value: String(value), dataType: "numeric" as const, source: "code" as const, comment: null });
const item = (scores: ReturnType<typeof bool>[], error: string | null = null): DatasetRunItemResult =>
  ({ itemIndex: 0, traceId: null, input: null, output: null, error, scores }) as unknown as DatasetRunItemResult;

describe("matchesTarget", () => {
  it("a target ending in / is a prefix of the run name; otherwise it is the dataset name", () => {
    expect(matchesTarget({ name: "redteam/demo-v1", datasetName: "attacks" }, "redteam/")).toBe(true);
    expect(matchesTarget({ name: "nightly", datasetName: "redteam/x" }, "redteam/")).toBe(false);
    expect(matchesTarget({ name: "nightly", datasetName: "weather" }, "weather")).toBe(true);
    expect(matchesTarget({ name: "weather-run", datasetName: "weather-2" }, "weather")).toBe(false);
  });
});

describe("runScore", () => {
  it("'any check' passes an item when no boolean score is false, and skips errored items", () => {
    const results = [item([bool("a", true), bool("b", true)]), item([bool("a", true), bool("b", false)]), item([], "boom"), item([num("n", 1)] as never)];
    expect(runScore(results, "")).toEqual({ value: 50, evaluated: 2 });
  });

  it("a named boolean score is a pass rate in %", () => {
    expect(runScore([item([bool("ok", true)]), item([bool("ok", true)]), item([bool("ok", false)]), item([bool("other", false)])], "ok")).toEqual({ value: (2 / 3) * 100, evaluated: 3 });
  });

  it("a numeric score is the mean of a 0-1 value, in %", () => {
    expect(runScore([item([num("c", 1)] as never), item([num("c", 0.5)] as never)], "c")).toEqual({ value: 75, evaluated: 2 });
  });

  it("nothing evaluated is null, not zero", () => {
    expect(runScore([], "")).toEqual({ value: null, evaluated: 0 });
    expect(runScore([item([], "boom")], "x")).toEqual({ value: null, evaluated: 0 });
  });
});
