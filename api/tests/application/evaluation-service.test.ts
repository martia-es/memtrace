import { describe, expect, it } from "vitest";
import { EvaluationService } from "@/application/evaluation-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemSubmission } from "@/domain/evaluation";
import type { DatasetRun, DatasetVersion } from "@/domain/identity";

const LATEST_VERSION: DatasetVersion = { id: "ver-1", datasetId: "ds-1", major: 1, minor: 0, note: null, createdBy: "user-1", createdByEmail: "user@example.com", createdAt: "2026-09-30T00:00:00Z" };

// Solo implementa lo que EvaluationService realmente llama: no tiene sentido escribir un fake
// completo de un puerto de 20 métodos para probar un caso de uso que usa uno solo.
function fakeIdentity(createDatasetRun: IdentityRepository["createDatasetRun"]): IdentityRepository {
  return { createDatasetRun, getLatestDatasetVersion: async () => LATEST_VERSION } as unknown as IdentityRepository;
}

function fakeScores(insertScores: ScoreRepository["insertScores"]): ScoreRepository {
  return { insertScores, listScoresByRun: async () => [], aggregateForRuns: async () => [] };
}

const ITEMS: DatasetRunItemSubmission[] = [
  { input: "2+2?", expectedOutput: "4", output: "4", traceId: "t1", error: null, scores: [{ name: "exact_match", value: "true", dataType: "boolean", source: "code", comment: null }] },
];

describe("EvaluationService.submitDatasetRun", () => {
  it("inserts scores in ClickHouse before creating the Postgres run record, with the same id", async () => {
    const calls: string[] = [];
    let insertedRunId: string | undefined;
    let createdWithId: string | undefined;

    const identity = fakeIdentity(async (id, datasetId, datasetVersionId, name, itemCount) => {
      calls.push("createDatasetRun");
      createdWithId = id;
      return { id, datasetId, datasetVersionId, versionMajor: 1, versionMinor: 0, name, itemCount, createdAt: "2026-09-30T00:00:00Z" } satisfies DatasetRun;
    });
    const scores = fakeScores(async (_serviceName, datasetRunId) => {
      calls.push("insertScores");
      insertedRunId = datasetRunId;
    });

    const service = new EvaluationService(identity, scores);
    const run = await service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS);

    expect(calls).toEqual(["insertScores", "createDatasetRun"]);
    expect(insertedRunId).toBe(createdWithId);
    expect(run.id).toBe(createdWithId);
    expect(run.itemCount).toBe(1);
  });

  it("never creates the Postgres run record if the ClickHouse insert fails", async () => {
    let created = false;
    const identity = fakeIdentity(async (id, datasetId, datasetVersionId, name, itemCount) => {
      created = true;
      return { id, datasetId, datasetVersionId, versionMajor: 1, versionMinor: 0, name, itemCount, createdAt: "2026-09-30T00:00:00Z" };
    });
    const scores = fakeScores(async () => {
      throw new Error("clickhouse is down");
    });

    const service = new EvaluationService(identity, scores);
    await expect(service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS)).rejects.toThrow("clickhouse is down");
    expect(created).toBe(false);
  });
});
