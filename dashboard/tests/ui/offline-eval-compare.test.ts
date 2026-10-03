import type { DatasetItemChangeDto, DatasetRunItemResultDto, DatasetRunSummaryDto, ScoreDto } from "@contract";
import { describe, expect, it } from "vitest";
import { datasetChangeFor, evaluatorDeltas, itemFlips, loadItemLatencies, pairItems, percentile, summarizeLatency } from "@/ui/offline-eval-compare";

const bool = (name: string, value: boolean): ScoreDto => ({ name, value: String(value), dataType: "boolean", source: "code", comment: null });
const item = (itemIndex: number, input: unknown, scores: ScoreDto[] = [], traceId: string | null = null): DatasetRunItemResultDto => ({ itemIndex, input, expectedOutput: null, output: null, traceId, error: null, scores });
const summary = (aggregates: DatasetRunSummaryDto["aggregates"]): DatasetRunSummaryDto => ({ id: "r", name: "r", versionMajor: 1, versionMinor: 0, itemCount: 1, status: "completed", createdAt: "2026-01-01T00:00:00Z", aggregates });

describe("pairItems", () => {
  it("pairs by input content regardless of index and reports unmatched sides", () => {
    const a = [item(0, "x"), item(1, "y")];
    const b = [item(0, "y"), item(1, "z")];
    const { paired, onlyA, onlyB } = pairItems(a, b);
    expect(paired.map((p) => [p.a.itemIndex, p.b.itemIndex])).toEqual([[1, 0]]);
    expect(onlyA.map((i) => i.input)).toEqual(["x"]);
    expect(onlyB.map((i) => i.input)).toEqual(["z"]);
  });
  it("pairs duplicate inputs one-to-one", () => {
    const { paired, onlyB } = pairItems([item(0, "x")], [item(0, "x"), item(1, "x")]);
    expect(paired).toHaveLength(1);
    expect(onlyB).toHaveLength(1);
  });
});

describe("itemFlips", () => {
  it("lists regressions before improvements and ignores unchanged", () => {
    const a = [item(0, "p", [bool("ok", true)]), item(1, "q", [bool("ok", false)]), item(2, "r", [bool("ok", true)])];
    const b = [item(0, "p", [bool("ok", false)]), item(1, "q", [bool("ok", true)]), item(2, "r", [bool("ok", true)])];
    const flips = itemFlips(pairItems(a, b).paired);
    expect(flips.map((f) => [f.pair.key, f.outcome])).toEqual([['"p"', "regressed"], ['"q"', "improved"]]);
  });
});

describe("evaluatorDeltas", () => {
  it("computes B-A in rate units and flags judge changes", () => {
    const j = (model: string) => [{ model, promptHash: "h" }];
    const a = summary([{ name: "ok", dataType: "boolean", passRate: 0.5, average: null, count: 2, judges: j("m1") }]);
    const b = summary([{ name: "ok", dataType: "boolean", passRate: 1, average: null, count: 2, judges: j("m2") }]);
    const [d] = evaluatorDeltas(a, b);
    expect(d).toMatchObject({ name: "ok", a: 0.5, b: 1, delta: 0.5, isRate: true, judgeChanged: true });
  });
});

describe("datasetChangeFor", () => {
  it("finds the dataset change that touched an input", () => {
    const change = { originItemId: "1", kind: "modified", before: { input: "old" }, after: { input: "new" } } as unknown as DatasetItemChangeDto;
    expect(datasetChangeFor([change], "new")).toBe(change);
    expect(datasetChangeFor([change], "other")).toBeNull();
  });
});

describe("latency", () => {
  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(summarizeLatency([400, 100, 200, 300], 4, 5)).toMatchObject({ p50: 200, p95: 400, max: 400, count: 4, total: 5 });
  });
  it("skips items without a trace and tolerates failing lookups", async () => {
    const items = [item(0, "a", [], "t1"), item(1, "b"), item(2, "c", [], "bad")];
    const { summary: s } = await loadItemLatencies(items, async (id) => {
      if (id === "bad") throw new Error("gone");
      return 120;
    });
    expect(s).toMatchObject({ count: 1, covered: 2, total: 3, p50: 120 });
  });
});
