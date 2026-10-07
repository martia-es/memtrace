import { describe, expect, it, vi } from "vitest";
import { DatasetRunClosedError, EvaluationService } from "@/application/evaluation-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemSubmission } from "@/domain/evaluation";
import type { DatasetRun, DatasetVersion } from "@/domain/identity";

const V1_0: DatasetVersion = { id: "ver-1", datasetId: "ds-1", major: 1, minor: 0, note: null, createdBy: "user-1", createdByEmail: "user@example.com", createdAt: "2026-09-30T00:00:00Z" };
const V1_1: DatasetVersion = { ...V1_0, id: "ver-2", minor: 1 };

function run(over: Partial<DatasetRun> = {}): DatasetRun {
  return { id: "run-1", datasetId: "ds-1", datasetVersionId: "ver-1", versionMajor: 1, versionMinor: 0, name: "r", itemCount: 0, status: "running", createdAt: "2026-09-30T00:00:00Z", revision: null, revisionDirty: null, ...over };
}

// Solo implementa lo que EvaluationService realmente llama: no tiene sentido escribir un fake
// completo de un puerto de 20 métodos para probar un caso de uso que usa uno solo.
function fakeIdentity(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  const defaults: Partial<IdentityRepository> = {
    createDatasetRun: async (id, datasetId, datasetVersionId, name, itemCount, status) => run({ id, datasetId, datasetVersionId, name, itemCount, status }),
    getDatasetRun: async () => null,
    updateDatasetRunProgress: async (runId, itemCount, completed) => run({ id: runId, itemCount, status: completed ? "completed" : "running" }),
    listDatasetVersions: async () => [V1_1, V1_0],
  };
  return { ...defaults, ...overrides } as unknown as IdentityRepository;
}

function fakeScores(insertScores: ScoreRepository["insertScores"], materializeRunSummary: ScoreRepository["materializeRunSummary"] = async () => {}): ScoreRepository {
  return { insertScores, materializeRunSummary, listScoresByRun: async () => [], aggregateForRuns: async () => [], listScoresByTrace: async () => [], listJudgeScoresForRuns: async () => [] };
}

const ITEMS: DatasetRunItemSubmission[] = [
  { input: "2+2?", expectedOutput: "4", output: "4", traceId: "t1", error: null, scores: [{ name: "exact_match", value: "true", dataType: "boolean", source: "code", comment: null }] },
];

describe("EvaluationService.submitDatasetRun", () => {
  it("records the evaluated commit on the run (ADR-065)", async () => {
    let received: unknown = "unset";
    const identity = fakeIdentity({
      createDatasetRun: async (id, datasetId, datasetVersionId, name, itemCount, status, revision) => {
        received = revision;
        return run({ id, datasetId, datasetVersionId, name, itemCount, status, revision: revision?.sha ?? null, revisionDirty: revision?.dirty ?? null });
      },
    });
    const sha = "a".repeat(40);
    const created = await new EvaluationService(identity, fakeScores(async () => {})).submitDatasetRun("my-agent", "ds-1", "r", ITEMS, "1.0", true, { sha, dirty: false });
    expect(received).toEqual({ sha, dirty: false });
    expect(created).toMatchObject({ revision: sha, revisionDirty: false });
  });

  it("inserts scores in ClickHouse before creating the Postgres run record, with the same id", async () => {
    const calls: string[] = [];
    let insertedRunId: string | undefined;
    let createdWithId: string | undefined;

    const identity = fakeIdentity({
      createDatasetRun: async (id, datasetId, datasetVersionId, name, itemCount, status) => {
        calls.push("createDatasetRun");
        createdWithId = id;
        return run({ id, datasetId, datasetVersionId, name, itemCount, status });
      },
    });
    const scores = fakeScores(async (_serviceName, datasetRunId) => {
      calls.push("insertScores");
      insertedRunId = datasetRunId;
    });

    const created = await new EvaluationService(identity, scores).submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0");

    expect(calls).toEqual(["insertScores", "createDatasetRun"]);
    expect(insertedRunId).toBe(createdWithId);
    expect(created.id).toBe(createdWithId);
    expect(created.itemCount).toBe(1);
    expect(created.status).toBe("completed");
  });

  it("never creates the Postgres run record if the ClickHouse insert fails", async () => {
    let created = false;
    const identity = fakeIdentity({ createDatasetRun: async () => { created = true; return run(); } });
    const scores = fakeScores(async () => {
      throw new Error("clickhouse is down");
    });

    await expect(new EvaluationService(identity, scores).submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0")).rejects.toThrow("clickhouse is down");
    expect(created).toBe(false);
  });

  it("records the run against the declared dataset version, not the latest", async () => {
    let usedVersionId: string | undefined;
    const identity = fakeIdentity({ createDatasetRun: async (id, datasetId, datasetVersionId) => { usedVersionId = datasetVersionId; return run({ id, datasetId, datasetVersionId }); } });
    await new EvaluationService(identity, fakeScores(async () => {})).submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0");
    expect(usedVersionId).toBe("ver-1");
  });

  it("leaves the run open (`running`) when not complete", async () => {
    const created = await new EvaluationService(fakeIdentity(), fakeScores(async () => {})).submitDatasetRun("my-agent", "ds-1", "run-1", [], "1.1", false);
    expect(created.status).toBe("running");
  });

  it("rejects an unknown or malformed version before writing any score", async () => {
    let inserted = false;
    const service = new EvaluationService(fakeIdentity(), fakeScores(async () => { inserted = true; }));
    await expect(service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "9.9")).rejects.toThrow(/no version 9\.9/);
    await expect(service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "abc")).rejects.toThrow(/major\.minor/);
    expect(inserted).toBe(false);
  });
});

describe("EvaluationService.appendToDatasetRun", () => {
  it("writes the batch at its startIndex and grows the run", async () => {
    let usedStart: number | undefined;
    let progress: [number, boolean] | undefined;
    const identity = fakeIdentity({
      getDatasetRun: async () => run(),
      updateDatasetRunProgress: async (id, itemCount, completed) => { progress = [itemCount, completed]; return run({ id, itemCount }); },
    });
    const scores = fakeScores(async (_s, _r, _items, startIndex) => { usedStart = startIndex; });

    await new EvaluationService(identity, scores).appendToDatasetRun("my-agent", "ds-1", "run-1", 20, ITEMS, true);

    expect(usedStart).toBe(20);
    expect(progress).toEqual([21, true]);
  });

  it("sizes the run by the highest explicit itemIndex, so items can arrive out of order", async () => {
    let progress: number | undefined;
    const identity = fakeIdentity({
      getDatasetRun: async () => run(),
      updateDatasetRunProgress: async (id, itemCount) => { progress = itemCount; return run({ id, itemCount }); },
    });
    const late = [{ ...ITEMS[0]!, itemIndex: 7 }, { ...ITEMS[0]!, itemIndex: 2 }];

    await new EvaluationService(identity, fakeScores(async () => {})).appendToDatasetRun("my-agent", "ds-1", "run-1", 0, late, false);

    expect(progress).toBe(8);
  });

  it("returns null for an unknown run or one of another dataset", async () => {
    const service = new EvaluationService(fakeIdentity({ getDatasetRun: async () => run({ datasetId: "other" }) }), fakeScores(async () => {}));
    expect(await service.appendToDatasetRun("my-agent", "ds-1", "run-1", 0, ITEMS, false)).toBeNull();
  });

  it("refuses to add items to a completed run", async () => {
    let inserted = false;
    const service = new EvaluationService(fakeIdentity({ getDatasetRun: async () => run({ status: "completed" }) }), fakeScores(async () => { inserted = true; }));
    await expect(service.appendToDatasetRun("my-agent", "ds-1", "run-1", 0, ITEMS, false)).rejects.toBeInstanceOf(DatasetRunClosedError);
    expect(inserted).toBe(false);
  });
});

describe("EvaluationService run summaries (ADR-045)", () => {
  it("stores the summary only when the run is completed", async () => {
    const summarized: string[] = [];
    const scores = fakeScores(async () => {}, async (_s, runId) => void summarized.push(runId));
    const service = new EvaluationService(fakeIdentity(), scores);
    await service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0", false);
    expect(summarized).toEqual([]);
    await service.submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0", true);
    expect(summarized).toHaveLength(1);
  });

  it("does not fail the upload when the summary cannot be written", async () => {
    const scores = fakeScores(async () => {}, async () => { throw new Error("clickhouse is down"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(new EvaluationService(fakeIdentity(), scores).submitDatasetRun("my-agent", "ds-1", "run-1", ITEMS, "1.0")).resolves.toBeDefined();
  });
});
