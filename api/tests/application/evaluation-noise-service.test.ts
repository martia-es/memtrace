import { describe, expect, it } from "vitest";
import { EvaluationNoiseService } from "@/application/evaluation-noise-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemResult, ScoreAggregate } from "@/domain/evaluation";
import type { DatasetRunWithDataset } from "@/domain/identity";

const SCOPE = { experimentId: "exp-1", serviceName: "agent" };
const GROUP = "7d9f6c44-0f5a-4d6e-9d0e-2d1c5a2b9e11";

const run = (id: string, over: Partial<DatasetRunWithDataset> = {}): DatasetRunWithDataset => ({
  id, datasetId: "ds-1", datasetVersionId: "v1", versionMajor: 1, versionMinor: 2, name: "r", itemCount: 2, status: "completed",
  createdAt: "2026-10-12T10:00:00Z", revision: null, revisionDirty: null, runGroup: null, datasetName: "D", ...over,
});
const inGroup = (id: string, index: number, over: Partial<DatasetRunWithDataset> = {}) => run(id, { runGroup: { id: GROUP, index, total: 3 }, ...over });
const agg = (datasetRunId: string, passRate: number): ScoreAggregate => ({ datasetRunId, name: "acc", dataType: "boolean", passRate, average: null, count: 2, judges: [] });
const item = (itemIndex: number, value: string): DatasetRunItemResult => ({
  itemIndex, input: `q${itemIndex}`, expectedOutput: null, output: null, traceId: null, error: null,
  scores: [{ name: "acc", value, dataType: "boolean", source: "code", comment: null }],
});

function service(runs: DatasetRunWithDataset[], passRates: Record<string, number>, items: Record<string, DatasetRunItemResult[]> = {}) {
  const identity = { listRunsForExperiment: async () => runs } as unknown as IdentityRepository;
  const asked: string[][] = [];
  const scores = {
    aggregateForRuns: async (_s: unknown, ids: string[]) => { asked.push(ids); return ids.filter((id) => id in passRates).map((id) => agg(id, passRates[id]!)); },
    listScoresByRun: async (_s: unknown, id: string) => items[id] ?? [],
  } as unknown as ScoreRepository;
  return { svc: new EvaluationNoiseService(identity, scores), asked };
}

describe("EvaluationNoiseService.variability", () => {
  const runs = [inGroup("e3", 3), run("other"), inGroup("e1", 1), inGroup("e2", 2)];
  const rates = { e1: 0.88, e2: 0.92, e3: 0.9 };

  it("gathers every execution of the group in order, whichever one was asked for", async () => {
    const { svc } = service(runs, rates);
    const v = await svc.variability(SCOPE, "exp-1", "e2");
    expect(v!.executions.map((e) => [e.runId, e.index])).toEqual([["e1", 1], ["e2", 2], ["e3", 3]]);
    expect(v!.group).toEqual({ id: GROUP, total: 3, completed: 3 });
    expect(v!.evaluators[0]).toMatchObject({ name: "acc", values: [0.88, 0.92, 0.9] });
    expect(v!.evaluators[0]!.noise).toBeCloseTo(0.02, 6);
  });

  it("lists the items whose result changes between executions", async () => {
    const { svc } = service(runs, rates, {
      e1: [item(0, "true"), item(1, "true")], e2: [item(0, "false"), item(1, "true")], e3: [item(0, "true"), item(1, "true")],
    });
    const v = await svc.variability(SCOPE, "exp-1", "e1");
    expect(v!.instability).toEqual([{ evaluator: "acc", unstable: 1, total: 2 }]);
    expect(v!.unstableItems).toEqual([{ itemIndex: 0, input: "q0", evaluator: "acc", outcomes: ["true", "false", "true"] }]);
  });

  it("only counts completed executions: one that is still uploading would give a half aggregate", async () => {
    const { svc, asked } = service([inGroup("e1", 1), inGroup("e2", 2, { status: "running" }), inGroup("e3", 3)], rates);
    const v = await svc.variability(SCOPE, "exp-1", "e1");
    expect(asked[0]).toEqual(["e1", "e3"]);
    expect(v!.group).toMatchObject({ total: 3, completed: 2 });
    expect(v!.executions).toHaveLength(3);
    expect(v!.evaluators[0]!.values).toEqual([0.88, 0.9]);
  });

  it("answers a run without repetitions with no group and no noise", async () => {
    const { svc } = service([run("solo")], { solo: 0.8 });
    const v = await svc.variability(SCOPE, "exp-1", "solo");
    expect(v!.group).toBeNull();
    expect(v!.evaluators[0]).toMatchObject({ values: [0.8], noise: null });
    expect(v!.unstableItems).toEqual([]);
  });

  it("returns null for a run that is not in the experiment", async () => {
    expect((await service(runs, rates).svc.variability(SCOPE, "exp-1", "nope"))).toBeNull();
  });
});

describe("EvaluationNoiseService.compare", () => {
  it("uses the whole group of each side and the noise measured in it", async () => {
    const { svc } = service([inGroup("e1", 1), inGroup("e2", 2), inGroup("e3", 3), run("cand")], { e1: 0.88, e2: 0.9, e3: 0.92, cand: 0.96 });
    const c = await svc.compare(SCOPE, "exp-1", "e2", "cand");
    expect(c!.baseline).toEqual({ runId: "e2", executions: 3 });
    expect(c!.candidate).toEqual({ runId: "cand", executions: 1 });
    expect(c!.evaluators[0]).toMatchObject({ name: "acc", verdict: "above" });
    expect(c!.evaluators[0]!.delta).toBeCloseTo(0.06);
  });

  it("says 'not measured' when neither side has repetitions", async () => {
    const { svc } = service([run("a"), run("b")], { a: 0.8, b: 0.9 });
    expect((await svc.compare(SCOPE, "exp-1", "a", "b"))!.evaluators[0]).toMatchObject({ verdict: "not_measured", reason: "no_repetitions" });
  });

  it("returns null when either run is missing", async () => {
    expect(await service([run("a")], {}).svc.compare(SCOPE, "exp-1", "a", "ghost")).toBeNull();
  });
});
