import { beforeEach, describe, expect, it } from "vitest";
import { AgreementService } from "@/application/agreement-service";
import type { JudgeScoreRow } from "@/application/ports/score-repository";
import type { AnnotationQueue, QueueItem } from "@/domain/annotation-queue";
import type { Annotation } from "@/domain/annotation";
import { AnnotationQueueNotFoundError, DatasetRunNotFoundError } from "@/domain/errors";
import { FakeAnnotationQueueRepository, FakeAnnotationRepository } from "../helpers";

const SERVICE = "svc";
const actor = { experimentId: "e1", serviceName: SERVICE };

const queue: AnnotationQueue = {
  id: "q1",
  experimentId: "e1",
  name: "Review",
  instructions: null,
  requiredAnnotations: 2,
  rubric: [{ configId: "cfg-ok", required: true, position: 0 }],
  createdBy: "u1",
  createdAt: "2026-10-03T00:00:00.000Z",
  archivedAt: null,
};

function item(overrides: Partial<QueueItem>): QueueItem {
  return {
    id: `i-${Math.random()}`,
    queueId: "q1",
    targetType: "run_item",
    traceId: null,
    datasetRunId: "run-1",
    itemIndex: 0,
    status: "completed",
    population: "manual",
    sampleSeed: null,
    addedBy: "u1",
    addedAt: "2026-10-03T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function judgeRow(itemIndex: number, value: string, overrides: Partial<JudgeScoreRow> = {}): JudgeScoreRow {
  return { datasetRunId: "run-1", itemIndex, name: "ok", value, dataType: "boolean", judgeModel: "m1", judgePromptHash: "h1", ...overrides };
}

function label(itemIndex: number, annotatorId: string, value: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    traceId: "",
    spanId: null,
    configId: "cfg-ok",
    configName: "ok",
    dataType: "boolean",
    annotatorId,
    value,
    comment: null,
    createdAt: "2026-10-03T00:00:00.000Z",
    datasetRunId: "run-1",
    itemIndex,
    ...overrides,
  };
}

describe("AgreementService (ADR-040)", () => {
  let queues: FakeAnnotationQueueRepository;
  let annotations: FakeAnnotationRepository;
  let judgeRows: JudgeScoreRow[];
  let judgeCalls: Array<{ runIds: string[]; name?: string }>;
  let service: AgreementService;

  beforeEach(() => {
    queues = new FakeAnnotationQueueRepository();
    queues.queues = [queue];
    annotations = new FakeAnnotationRepository();
    judgeRows = [];
    judgeCalls = [];
    service = new AgreementService(
      { listRunsForExperiment: async () => [{ id: "run-1" }] as never },
      {
        listJudgeScoresForRuns: async (_service, runIds, name) => {
          judgeCalls.push({ runIds, name });
          return judgeRows.filter((r) => runIds.includes(r.datasetRunId) && (name === undefined || r.name === name));
        },
      },
      annotations,
      queues,
    );
  });

  const addLabels = async (...rows: Annotation[]) => {
    for (const row of rows) await annotations.upsert(SERVICE, row);
  };

  describe("judgeHuman — run scope", () => {
    it("pairs judge scores with run-item labels by (run, index) and name", async () => {
      judgeRows = [judgeRow(0, "true"), judgeRow(1, "false"), judgeRow(2, "true")];
      await addLabels(label(0, "ana", "true"), label(1, "ana", "true"), label(2, "ana", "true"));
      const result = await service.judgeHuman(actor, { datasetRunId: "run-1" });
      expect(result.scope).toEqual({ type: "run", id: "run-1", traceTargets: 0 });
      const [metric] = result.metrics;
      expect(metric).toMatchObject({ name: "ok", status: "ok", n: 3, lowSample: true, judge: { model: "m1", promptHash: "h1" } });
      expect(metric!.percentAgreement).toBeCloseTo(2 / 3, 10);
      expect(metric!.disagreements).toEqual([{ target: "run:run-1:1", judge: "false", human: "true" }]);
    });

    it("rejects a run that does not belong to the experiment", async () => {
      await expect(service.judgeHuman(actor, { datasetRunId: "other" })).rejects.toBeInstanceOf(DatasetRunNotFoundError);
    });

    it("lists names present on one side only as unmatched, without computing them", async () => {
      judgeRows = [judgeRow(0, "true", { name: "faithfulness" }), judgeRow(0, "true")];
      await addLabels(label(0, "ana", "true"), label(0, "ana", "yes", { configId: "cfg-tone", configName: "tone", dataType: "categorical" }));
      const result = await service.judgeHuman(actor, { datasetRunId: "run-1" });
      expect(result.metrics.map((m) => m.name)).toEqual(["ok"]);
      expect(result.unmatched).toEqual({ judgeOnly: ["faithfulness"], humanOnly: ["tone"] });
    });

    it("passes the name filter down to both reads", async () => {
      judgeRows = [judgeRow(0, "true"), judgeRow(0, "true", { name: "other" })];
      await addLabels(label(0, "ana", "true"), label(0, "ana", "true", { configName: "other", configId: "cfg-other" }));
      const result = await service.judgeHuman(actor, { datasetRunId: "run-1" }, "ok");
      expect(judgeCalls[0]!.name).toBe("ok");
      expect(result.metrics.map((m) => m.name)).toEqual(["ok"]);
    });

    it("reports mixed_judges instead of averaging two judge identities", async () => {
      judgeRows = [judgeRow(0, "true"), judgeRow(1, "true", { judgePromptHash: "h2" })];
      await addLabels(label(0, "ana", "true"), label(1, "ana", "true"));
      const [metric] = (await service.judgeHuman(actor, { datasetRunId: "run-1" })).metrics;
      expect(metric).toMatchObject({ status: "mixed_judges", judge: null, n: 0 });
      expect(metric!.judges).toHaveLength(2);
    });

    it("groups scores without recorded identity as one unknown judge", async () => {
      judgeRows = [judgeRow(0, "true", { judgeModel: null, judgePromptHash: null }), judgeRow(1, "true", { judgeModel: null, judgePromptHash: null })];
      await addLabels(label(0, "ana", "true"), label(1, "ana", "true"));
      const [metric] = (await service.judgeHuman(actor, { datasetRunId: "run-1" })).metrics;
      expect(metric).toMatchObject({ status: "ok", n: 2, judge: { model: null, promptHash: null } });
    });

    it("marks different data types as incomparable", async () => {
      judgeRows = [judgeRow(0, "true")];
      await addLabels(label(0, "ana", "4", { dataType: "numeric" }));
      const [metric] = (await service.judgeHuman(actor, { datasetRunId: "run-1" })).metrics;
      expect(metric).toMatchObject({ status: "incomparable", n: 0 });
    });
  });

  describe("judgeHuman — queue scope", () => {
    beforeEach(() => {
      queues.items = [
        item({ itemIndex: 0 }),
        item({ itemIndex: 1 }),
        item({ targetType: "trace", traceId: "t1", datasetRunId: null, itemIndex: null }),
      ];
    });

    it("only considers the queue's run items and counts trace targets as not pairable", async () => {
      judgeRows = [judgeRow(0, "true"), judgeRow(1, "true"), judgeRow(5, "false")]; // el 5 no está en la cola
      await addLabels(label(0, "ana", "true"), label(1, "ana", "false"), label(5, "ana", "true"));
      const result = await service.judgeHuman(actor, { queueId: "q1" });
      expect(result.scope).toMatchObject({ type: "queue", id: "q1", traceTargets: 1 });
      expect(result.metrics[0]).toMatchObject({ n: 2 });
      expect(result.metrics[0]!.percentAgreement).toBe(0.5);
    });

    it("reports how the queue's run items were chosen, so a biased sample is visible", async () => {
      queues.items = [item({ itemIndex: 0, population: "random_sample", sampleSeed: "s" }), item({ itemIndex: 1, population: "random_sample", sampleSeed: "s" }), item({ itemIndex: 2, population: "manual" }), item({ targetType: "trace", traceId: "t1", datasetRunId: null, itemIndex: null, population: "filter" })];
      const result = await service.judgeHuman(actor, { queueId: "q1" });
      expect(result.scope.population).toEqual({ manual: 1, filter: 0, randomSample: 2 });
    });

    it("gives no population for a run scope", async () => {
      expect((await service.judgeHuman(actor, { datasetRunId: "run-1" })).scope.population).toBeUndefined();
    });

    it("ignores labels of configs outside the queue rubric", async () => {
      judgeRows = [judgeRow(0, "true")];
      await addLabels(label(0, "ana", "false", { configId: "cfg-elsewhere" }));
      const result = await service.judgeHuman(actor, { queueId: "q1" });
      expect(result.metrics).toEqual([]);
      expect(result.unmatched.judgeOnly).toEqual(["ok"]);
    });

    it("404s for a queue of another experiment", async () => {
      await expect(service.judgeHuman({ ...actor, experimentId: "e2" }, { queueId: "q1" })).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);
    });
  });

  describe("interAnnotator", () => {
    it("measures agreement across run items and whole-trace labels of the queue", async () => {
      queues.items = [item({ itemIndex: 0 }), item({ itemIndex: 1 }), item({ targetType: "trace", traceId: "t1", datasetRunId: null, itemIndex: null })];
      await addLabels(
        label(0, "ana", "true"), label(0, "luis", "true"),
        label(1, "ana", "true"), label(1, "luis", "false"),
        label(0, "ana", "true", { datasetRunId: undefined, itemIndex: undefined, traceId: "t1" }),
        label(0, "luis", "false", { datasetRunId: undefined, itemIndex: undefined, traceId: "t1" }),
        label(9, "ana", "true"), // item fuera de la cola
        label(9, "luis", "true"),
      );
      const result = await service.interAnnotator(actor, "q1");
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0]).toMatchObject({ name: "ok", annotators: 2, n: 3, pairs: 1 });
    });

    it("404s for an unknown queue", async () => {
      await expect(service.interAnnotator(actor, "nope")).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);
    });
  });
});
