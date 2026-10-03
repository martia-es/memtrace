import type { RunListItemDto } from "@contract";
import { describe, expect, it } from "vitest";
import { buildOfflineSeries, judgeChangeNotices, selectOfflineRuns } from "@/ui/offline-eval-chart-option";

function run(id: string, createdAt: string, over: Partial<RunListItemDto> = {}): RunListItemDto {
  return { id, name: id, versionMajor: 1, versionMinor: 0, itemCount: 2, status: "completed", createdAt, aggregates: [], datasetId: "d1", datasetName: "D1", ...over };
}
const range = { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" };

describe("selectOfflineRuns", () => {
  it("drops running runs, filters range/dataset and sorts oldest first", () => {
    const runs = [
      run("b", "2026-03-02T00:00:00Z"),
      run("a", "2026-03-01T00:00:00Z"),
      run("live", "2026-03-03T00:00:00Z", { status: "running" }),
      run("old", "2025-01-01T00:00:00Z"),
      run("other", "2026-03-04T00:00:00Z", { datasetId: "d2" }),
    ];
    expect(selectOfflineRuns(runs, range, "d1").map((r) => r.id)).toEqual(["a", "b"]);
    expect(selectOfflineRuns(runs, range, null).map((r) => r.id)).toEqual(["a", "b", "other"]);
  });
});

describe("buildOfflineSeries", () => {
  it("builds one series per evaluator with null gaps, split by kind", () => {
    const runs = [
      run("a", "2026-03-01T00:00:00Z", { aggregates: [{ name: "exact", dataType: "boolean", passRate: 0.5, average: null, count: 2, judges: [] }] }),
      run("b", "2026-03-02T00:00:00Z", {
        aggregates: [
          { name: "exact", dataType: "boolean", passRate: 1, average: null, count: 2, judges: [] },
          { name: "judge", dataType: "numeric", passRate: null, average: 4.2, count: 2, judges: [] },
        ],
      }),
    ];
    expect(buildOfflineSeries(runs, "passRate")).toEqual([{ name: "exact", values: [0.5, 1], judgeChanged: [false, false] }]);
    expect(buildOfflineSeries(runs, "average")).toEqual([{ name: "judge", values: [null, 4.2], judgeChanged: [false, false] }]);
  });
});

describe("judge change detection (ADR-043)", () => {
  const agg = (judges: Array<{ model: string | null; promptHash: string | null }>, passRate = 0.9) => ({ name: "correctness", dataType: "boolean" as const, passRate, average: null, count: 4, judges });
  const J1 = [{ model: "m1", promptHash: "h1" }];
  const runs = [
    run("a", "2026-03-01T00:00:00Z", { aggregates: [agg(J1)] }),
    run("b", "2026-03-02T00:00:00Z", { aggregates: [agg(J1)] }),
    run("c", "2026-03-03T00:00:00Z", { aggregates: [agg([{ model: "m2", promptHash: "h1" }])] }),
    run("d", "2026-03-04T00:00:00Z", { aggregates: [agg([{ model: "m2", promptHash: "h2" }])] }),
  ];

  it("flags the point where the model or the rubric changes", () => {
    expect(buildOfflineSeries(runs, "passRate")[0]!.judgeChanged).toEqual([false, false, true, true]);
  });

  it("builds one notice per change with readable signatures", () => {
    const notices = judgeChangeNotices(runs);
    expect(notices.map((n) => [n.fromRun, n.toRun])).toEqual([["b · v1.0", "c · v1.0"], ["c · v1.0", "d · v1.0"]]);
    expect(notices[0]).toMatchObject({ evaluator: "correctness", from: "m1 · rubric h1", to: "m2 · rubric h1" });
  });

  it("never flags code evaluators or runs without a recorded judge on either side", () => {
    const code = (passRate: number) => ({ ...agg([]), name: "exact", passRate });
    expect(judgeChangeNotices([run("a", "2026-03-01T00:00:00Z", { aggregates: [code(1)] }), run("b", "2026-03-02T00:00:00Z", { aggregates: [code(0)] })])).toEqual([]);
    expect(judgeChangeNotices([run("a", "2026-03-01T00:00:00Z", { aggregates: [agg([])] }), run("b", "2026-03-02T00:00:00Z", { aggregates: [agg(J1)] })])).toEqual([]);
  });

  it("compares against the last run that had the evaluator, skipping runs without it", () => {
    const withGap = [
      run("a", "2026-03-01T00:00:00Z", { aggregates: [agg(J1)] }),
      run("b", "2026-03-02T00:00:00Z", { aggregates: [] }),
      run("c", "2026-03-03T00:00:00Z", { aggregates: [agg([{ model: "m2", promptHash: "h1" }])] }),
    ];
    expect(judgeChangeNotices(withGap).map((n) => n.fromRun)).toEqual(["a · v1.0"]);
  });
});
