import type { DatasetItemChangeDto, DatasetRunItemResultDto, DatasetRunSummaryDto, ScoreDto } from "@contract";
import { describe, expect, it } from "vitest";
import { datasetChangeFor, evaluatorDeltas, itemFlips, pairItems, percentile, summarizeTelemetry } from "@/ui/offline-eval-compare";

const bool = (name: string, value: boolean): ScoreDto => ({ name, value: String(value), dataType: "boolean", source: "code", comment: null });
const item = (itemIndex: number, input: unknown, scores: ScoreDto[] = [], traceId: string | null = null): DatasetRunItemResultDto => ({ itemIndex, input, expectedOutput: null, output: null, traceId, error: null, scores, telemetry: null });
const summary = (aggregates: DatasetRunSummaryDto["aggregates"]): DatasetRunSummaryDto => ({ id: "r", name: "r", versionMajor: 1, versionMinor: 0, itemCount: 1, status: "completed", createdAt: "2026-01-01T00:00:00Z", revision: null, revisionDirty: null, aggregates });

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

describe("telemetry", () => {
  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });
  it("summarizes only the items whose trace was found", () => {
    const withT = (i: number, latencyMs: number, costUsd: number | null) => ({ ...item(i, "x", [], `t${i}`), telemetry: { latencyMs, inputTokens: 10, outputTokens: 5, costUsd, prompts: [] } });
    const items = [withT(0, 400, 0.01), withT(1, 100, null), withT(2, 200, 0.02), item(3, "no trace")];
    expect(summarizeTelemetry(items)).toMatchObject({ count: 3, total: 4, p50: 200, p95: 400, max: 400, inputTokens: 30, outputTokens: 15 });
    expect(summarizeTelemetry(items).costUsd).toBeCloseTo(0.03);
  });
  it("has no cost when no model is priced and no latency without telemetry", () => {
    expect(summarizeTelemetry([item(0, "a")])).toMatchObject({ count: 0, p50: null, costUsd: null, inputTokens: 0 });
  });
});
