import type { RunListItemDto } from "@contract";
import { describe, expect, it } from "vitest";
import { buildOfflineSeries, judgeChangeNotices, offlineAttention, offlineVerdict, passFailChartOption, selectOfflineRuns, summarizeEvaluators } from "@/ui/offline-eval-chart-option";

function run(id: string, createdAt: string, over: Partial<RunListItemDto> = {}): RunListItemDto {
  return { id, name: id, versionMajor: 1, versionMinor: 0, itemCount: 2, status: "completed", createdAt, revision: null, revisionDirty: null, aggregates: [], datasetId: "d1", datasetName: "D1", ...over };
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

describe("summarizeEvaluators", () => {
  const agg = (name: string, passRate: number, judges: string[] = ["gpt"]) => ({ name, dataType: "boolean" as const, passRate, average: null, count: 2, judges: judges.map((model) => ({ model, promptHash: "r" })) });
  it("compares the latest value with the previous run and flags judge changes", () => {
    const runs = [
      run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("exact", 0.5), agg("tone", 0.9)] }),
      run("b", "2026-03-02T00:00:00Z", { aggregates: [agg("exact", 0.8), agg("tone", 0.9, ["claude"])] }),
      run("c", "2026-03-03T00:00:00Z", { aggregates: [agg("exact", 0.7)] }),
      run("d", "2026-03-04T00:00:00Z", { aggregates: [agg("solo", 1)] }),
    ];
    const byName = Object.fromEntries(summarizeEvaluators(runs).map((s) => [s.name, s]));
    expect(byName.exact).toMatchObject({ latest: 0.7, previous: 0.8, status: "regressing" });
    expect(byName.tone).toMatchObject({ latest: 0.9, status: "judge-changed" });
    expect(byName.solo).toMatchObject({ latest: 1, previous: null, status: "first-run" });
  });
});

describe("offlineVerdict and pass/fail breakdown", () => {
  const agg = (name: string, passRate: number | null, count = 4) => ({ name, dataType: "boolean" as const, passRate, average: null, count, judges: [] });
  const verdictOf = (...rates: number[]) => offlineVerdict(summarizeEvaluators([run("a", "2026-03-01T00:00:00Z", { aggregates: rates.map((r, i) => agg(`e${i}`, r)) })]));

  it("derives passed/failed counts and tone from the latest run", () => {
    const [s] = summarizeEvaluators([run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("exact", 0.5)] })]);
    expect(s).toMatchObject({ passed: 2, failed: 2, count: 4, tone: "warning", history: [0.5] });
  });

  it("rates the system by its worst pass/fail evaluator", () => {
    expect(verdictOf(0.9, 0.85).level).toBe("healthy");
    expect(verdictOf(0.9, 0.6).level).toBe("attention");
    expect(verdictOf(0.9, 0.3).level).toBe("failing");
    expect(offlineVerdict([]).level).toBe("unknown");
  });

  it("plots one passed and one failed bar per boolean evaluator", () => {
    const summary = summarizeEvaluators([run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("x", 0.75)] })]);
    const option = passFailChartOption(summary, false) as { series: { name: string; data: number[] }[] };
    expect(option.series.map((s) => [s.name, s.data])).toEqual([["Passed", [3]], ["Failed", [1]]]);
  });
});

describe("offlineAttention", () => {
  const agg = (name: string, passRate: number, count = 4) => ({ name, dataType: "boolean" as const, passRate, average: null, count, judges: [] });
  const attentionOf = (...runs: RunListItemDto[]) => offlineAttention(runs, summarizeEvaluators(runs));

  it("is empty when every evaluator is healthy", () => {
    expect(attentionOf(run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("exact", 0.9)] }))).toEqual([]);
  });

  it("lists failing evaluators first and opens the latest run", () => {
    const items = attentionOf(run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("weak", 0.6), agg("bad", 0.25)] }));
    expect(items.map((i) => [i.key, i.tone, i.runId])).toEqual([["failing:bad", "error", "a"], ["weak:weak", "warn", "a"]]);
  });

  it("flags a regression with the previous and latest runs to compare", () => {
    const items = attentionOf(run("a", "2026-03-01T00:00:00Z", { aggregates: [agg("exact", 0.95)] }), run("b", "2026-03-02T00:00:00Z", { aggregates: [agg("exact", 0.85)] }));
    expect(items).toMatchObject([{ key: "regressing:exact", compare: ["a", "b"] }]);
  });
});

describe("per-evaluator target (ADR-060)", () => {
  const runs = [run("a", "2026-03-01T00:00:00Z", { aggregates: [{ name: "exact", dataType: "boolean", passRate: 0.9, average: null, count: 10, judges: [] }] })];

  it("judges each evaluator against its own target, defaulting to 80%", () => {
    expect(summarizeEvaluators(runs)[0]).toMatchObject({ target: 0.8, tone: "positive" });
    expect(summarizeEvaluators(runs, { exact: 0.95 })[0]).toMatchObject({ target: 0.95, tone: "warning" });
  });

  it("names the configured target in the attention list and the verdict", () => {
    const summary = summarizeEvaluators(runs, { exact: 0.95 });
    expect(offlineVerdict(summary).level).toBe("attention");
    expect(offlineAttention(runs, summary)[0]!.title).toBe("exact is below the 95% target");
  });
});
