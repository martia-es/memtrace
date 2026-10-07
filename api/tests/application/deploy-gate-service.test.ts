import { describe, expect, it } from "vitest";
import { DeployGateService } from "@/application/deploy-gate-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import { AssistantNotFoundError, ValidationError } from "@/domain/errors";
import type { DatasetRunWithDataset } from "@/domain/identity";
import type { ScoreAggregate } from "@/domain/evaluation";
import type { ScoreConfig } from "@/domain/score-config";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const run = (over: Partial<DatasetRunWithDataset> = {}): DatasetRunWithDataset => ({
  id: "r1", datasetId: "d1", datasetVersionId: "v1", versionMajor: 1, versionMinor: 0, name: "weather", itemCount: 5, status: "completed",
  createdAt: "2026-10-07T10:00:00Z", revision: SHA, revisionDirty: null, datasetName: "D", ...over,
});
const aggregate = (over: Partial<ScoreAggregate> = {}): ScoreAggregate => ({ datasetRunId: "r1", name: "exact_match", dataType: "boolean", passRate: 0.9, average: null, count: 5, judges: [], ...over });

function build(opts: { runs?: DatasetRunWithDataset[]; aggregates?: ScoreAggregate[]; configs?: Array<Partial<ScoreConfig>>; experiment?: boolean; deployed?: string[] } = {}) {
  const identity = { getExperiment: async () => (opts.experiment === false ? null : { id: "e1", serviceName: "weather" }), listRunsForExperiment: async () => opts.runs ?? [run()] } as unknown as IdentityRepository;
  const asked: string[][] = [];
  const scores = { aggregateForRuns: async (_s: string, ids: string[]) => (asked.push(ids), opts.aggregates ?? [aggregate()]) } as unknown as ScoreRepository;
  const configs = { list: async () => opts.configs ?? [] } as unknown as ScoreConfigRepository;
  return { service: new DeployGateService(identity, scores, configs, async () => opts.deployed ?? []), asked };
}

describe("DeployGateService (ADR-064)", () => {
  it("allows a commit with a passing evaluation", async () => {
    expect(await build().service.check("e1", SHA)).toMatchObject({ allowed: true, verdict: "allowed" });
  });

  it("only reads scores for the runs of that commit", async () => {
    const { service, asked } = build({ runs: [run(), run({ id: "r2", revision: "b".repeat(40) })] });
    await service.check("e1", SHA);
    expect(asked).toEqual([["r1"]]);
  });

  it("does not touch ClickHouse when nobody evaluated the commit", async () => {
    const { service, asked } = build({ runs: [run({ revision: "b".repeat(40) })] });
    expect(await service.check("e1", SHA)).toMatchObject({ allowed: false, verdict: "no_evaluation" });
    expect(asked).toEqual([]);
  });

  it("judges each evaluator against the target of its score config", async () => {
    const result = await build({ aggregates: [aggregate({ passRate: 0.9 })], configs: [{ name: "exact_match", targetPassRate: 0.95 }] }).service.check("e1", SHA);
    expect(result).toMatchObject({ allowed: false, verdict: "failed" });
  });

  it("lets a rollback through", async () => {
    expect(await build({ runs: [], deployed: [SHA] }).service.check("e1", "3a08213")).toMatchObject({ allowed: true, verdict: "rollback" });
  });

  it("rejects a bad SHA and an unknown experiment", async () => {
    await expect(build().service.check("e1", "main")).rejects.toBeInstanceOf(ValidationError);
    await expect(build({ experiment: false }).service.check("e1", SHA)).rejects.toBeInstanceOf(AssistantNotFoundError);
  });
});
