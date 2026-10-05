import { beforeEach, describe, expect, it } from "vitest";
import { AnnotationQueueService } from "@/application/annotation-queue-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import { ValidationError } from "@/domain/errors";
import { FakeAnnotationQueueRepository, FakeAnnotationRepository, FakeScoreConfigRepository, FakeTraceRepository, span } from "../helpers";

const SERVICE = "svc";
const ana = { userId: "ana", experimentId: "e1", serviceName: SERVICE };

describe("AnnotationQueueService — random sampling (ADR-040)", () => {
  let queues: FakeAnnotationQueueRepository;
  let traces: FakeTraceRepository;
  let runs: Array<{ id: string; itemCount: number }>;
  let service: AnnotationQueueService;
  let queueId: string;
  let seeds = 0;

  /** `n` trazas del servicio, devueltas por el listado en páginas de 200 como el repositorio real. */
  function registerTraces(n: number, { endless = false } = {}) {
    const ids = Array.from({ length: n }, (_, i) => `trace-${i}`);
    for (const id of ids) traces.traces.set(id, { spans: [span({ serviceName: SERVICE })], truncated: false });
    traces.listTraces = (async (q: { limit: number; cursor?: { startTimeUs: number } }) => {
      const start = q.cursor ? q.cursor.startTimeUs : 0;
      const items = ids.slice(start, start + q.limit);
      const next = endless || start + items.length < ids.length ? { startTimeUs: start + items.length, traceId: "x" } : null;
      return { items: items.map((traceId) => ({ traceId })), nextCursor: next };
    }) as never;
    return ids;
  }

  beforeEach(async () => {
    seeds = 0;
    queues = new FakeAnnotationQueueRepository();
    traces = new FakeTraceRepository();
    runs = [{ id: "run-1", itemCount: 1000 }];
    const configs = new FakeScoreConfigRepository();
    const identity = { getUsersByIds: async () => [], listRunsForExperiment: async () => runs, getExperiment: async () => ({ id: "e1", organizationId: "org-1" }), listOrgMembers: async () => [], listExperimentMembers: async () => [{ userId: "ana", email: "a@x.com", name: null, role: "member" }] } as unknown as IdentityRepository;
    service = new AnnotationQueueService(queues, configs, new FakeAnnotationRepository(), traces, identity, () => new Date("2026-10-03T10:00:00.000Z"), () => `seed-${++seeds}`);
    const configId = (await configs.create("e1", "u1", { name: "ok", dataType: "boolean", minValue: null, maxValue: null, categories: null, description: null })).id;
    queueId = (await service.create("e1", "u1", { name: "Review", instructions: null, requiredAnnotations: 1, reviewerIds: ["ana"], rubric: [{ configId, required: true }] })).id;
  });

  describe("fromRun", () => {
    it("samples distinct items of a run bigger than the per-request cap, and returns the seed used", async () => {
      const result = await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 50 } } });
      expect(result).toEqual({ added: 50, duplicates: 0, sample: { seed: "seed-1", size: 50, poolSize: 1000, truncated: false } });
      const indexes = queues.items.map((i) => i.itemIndex!);
      expect(new Set(indexes).size).toBe(50);
      expect(indexes.every((i) => i >= 0 && i < 1000)).toBe(true);
      expect(queues.items.every((i) => i.population === "random_sample" && i.sampleSeed === "seed-1")).toBe(true);
    });

    it("is reproducible with an explicit seed", async () => {
      await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 20, seed: "abc" } } });
      const first = queues.items.map((i) => i.itemIndex).sort((a, b) => a! - b!);
      queues.items = [];
      await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 20, seed: "abc" } } });
      expect(queues.items.map((i) => i.itemIndex).sort((a, b) => a! - b!)).toEqual(first);
    });

    it("takes every item of a small run when no sample is given, marked as filter-based", async () => {
      runs = [{ id: "run-1", itemCount: 3 }];
      expect(await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1" } })).toEqual({ added: 3, duplicates: 0 });
      expect(queues.items.map((i) => i.population)).toEqual(["filter", "filter", "filter"]);
    });

    it("refuses a whole run above the cap and points to sampling", async () => {
      const error = await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1" } }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((error as ValidationError).fields)).toContain("random sample");
    });

    it("samples everything when the run has fewer items than asked", async () => {
      runs = [{ id: "run-1", itemCount: 4 }];
      const result = await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 10 } } });
      expect(result).toMatchObject({ added: 4, sample: { size: 4, poolSize: 4 } });
    });

    it("rejects an unknown run and an invalid sample size", async () => {
      await expect(service.addItems(ana, queueId, { fromRun: { datasetRunId: "nope", sample: { size: 5 } } })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 0 } } })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 501 } } })).rejects.toBeInstanceOf(ValidationError);
    });

    it("keeps the original provenance of an item that was already in the queue", async () => {
      runs = [{ id: "run-1", itemCount: 2 }];
      await service.addItems(ana, queueId, { runItems: [{ datasetRunId: "run-1", itemIndex: 0 }] });
      const result = await service.addItems(ana, queueId, { fromRun: { datasetRunId: "run-1", sample: { size: 2 } } });
      expect(result).toMatchObject({ added: 1, duplicates: 1 });
      expect(queues.items.find((i) => i.itemIndex === 0)!.population).toBe("manual");
    });
  });

  describe("fromFilter", () => {
    it("samples from ALL matching traces, not just the first ones", async () => {
      registerTraces(1000);
      const result = await service.addItems(ana, queueId, { fromFilter: { hasErrors: true, sample: { size: 30 } } });
      expect(result.sample).toEqual({ seed: "seed-1", size: 30, poolSize: 1000, truncated: false });
      const picked = queues.items.map((i) => Number(i.traceId!.split("-")[1]));
      expect(picked.some((n) => n >= 500)).toBe(true);
      expect(queues.items.every((i) => i.population === "random_sample")).toBe(true);
    });

    it("flags a truncated pool when more traces match than are read", async () => {
      registerTraces(5200, { endless: false });
      const result = await service.addItems(ana, queueId, { fromFilter: { sample: { size: 10 } } });
      expect(result.sample).toMatchObject({ poolSize: 5000, truncated: true });
    });

    it("keeps the old first-N behaviour, marked as filter, when only a limit is given", async () => {
      registerTraces(10);
      expect(await service.addItems(ana, queueId, { fromFilter: { limit: 4 } })).toEqual({ added: 4, duplicates: 0 });
      expect(queues.items.map((i) => i.traceId)).toEqual(["trace-0", "trace-1", "trace-2", "trace-3"]);
      expect(queues.items.every((i) => i.population === "filter")).toBe(true);
    });

    it("requires exactly one of limit or sample", async () => {
      registerTraces(3);
      await expect(service.addItems(ana, queueId, { fromFilter: {} })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.addItems(ana, queueId, { fromFilter: { limit: 1, sample: { size: 1 } } })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it("marks explicit traces and run items as manual", async () => {
    registerTraces(2);
    await service.addItems(ana, queueId, { traceIds: ["trace-0"] });
    await service.addItems(ana, queueId, { runItems: [{ datasetRunId: "run-1", itemIndex: 7 }] });
    expect(queues.items.map((i) => i.population)).toEqual(["manual", "manual"]);
  });
});
