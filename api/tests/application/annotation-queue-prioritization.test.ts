import { beforeEach, describe, expect, it } from "vitest";
import { AnnotationQueueService } from "@/application/annotation-queue-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { EpisodeSignals } from "@/domain/uncertainty";
import { FakeAnnotationQueueRepository, FakeAnnotationRepository, FakeEpisodeRepository, FakeScoreConfigRepository, FakeTraceRepository, span } from "../helpers";

const ana = { userId: "ana", experimentId: "e1", serviceName: "svc" };
const sig = (over: Partial<EpisodeSignals>): EpisodeSignals => ({ value: 0, thumbs: 0, evalScore: null, hasError: false, reasons: [], ...over });

describe("AnnotationQueueService — priorización por incertidumbre", () => {
  let queues: FakeAnnotationQueueRepository;
  let configId: string;
  let service: AnnotationQueueService;

  beforeEach(async () => {
    queues = new FakeAnnotationQueueRepository();
    const traces = new FakeTraceRepository();
    for (const id of ["clear-ok", "clear-fail", "ambiguous", "no-episode"]) traces.traces.set(id, { spans: [span({ serviceName: "svc" })], truncated: false });
    const configs = new FakeScoreConfigRepository();
    const identity = { getUsersByIds: async () => [], listRunsForExperiment: async () => [], getExperiment: async () => ({ id: "e1", organizationId: "org-1" }), listOrgMembers: async () => [], listExperimentMembers: async () => [{ userId: "ana", email: "a@x.com", name: null, role: "member" }] } as unknown as IdentityRepository;
    const episodes = new FakeEpisodeRepository({
      "clear-ok": sig({ value: 0 }),
      "clear-fail": sig({ value: 2, hasError: true }),
      ambiguous: sig({ value: 0.45 }),
    });
    service = new AnnotationQueueService(queues, configs, new FakeAnnotationRepository(), traces, identity, () => new Date("2026-10-03T10:00:00.000Z"), () => "seed", episodes);
    configId = (await configs.create("e1", "u1", { name: "ok", dataType: "boolean", minValue: null, maxValue: null, categories: null, description: null })).id;
  });

  const newQueue = (prioritization?: "fifo" | "uncertainty") =>
    service.create("e1", "u1", { name: `q-${prioritization ?? "default"}`, instructions: null, requiredAnnotations: 1, prioritization, reviewerIds: ["ana"], rubric: [{ configId, required: true }] });
  const claimOrder = async (queueId: string) => {
    const queue = (await queues.get("e1", queueId))!;
    const order: string[] = [];
    for (let item = await queues.claimNext(queue, "ana"); item; item = await queues.claimNext(queue, "ana")) {
      order.push(item.traceId!);
      await queues.completeClaim(queue, item.id, "ana");
    }
    return order;
  };

  it("por defecto reparte en orden de llegada y no guarda prioridad", async () => {
    const q = await newQueue();
    expect(q.prioritization).toBe("fifo");
    await service.addItems(ana, q.id, { traceIds: ["clear-ok", "clear-fail", "ambiguous", "no-episode"] });
    expect(queues.items.every((i) => i.priority === null)).toBe(true);
    expect(await claimOrder(q.id)).toEqual(["clear-ok", "clear-fail", "ambiguous", "no-episode"]);
  });

  it("en `uncertainty` reparte primero lo dudoso y deja al final lo que no tiene episodio", async () => {
    const q = await newQueue("uncertainty");
    await service.addItems(ana, q.id, { traceIds: ["no-episode", "clear-ok", "ambiguous", "clear-fail"] });
    expect(queues.items.find((i) => i.traceId === "ambiguous")?.priority).toBe(1);
    expect(queues.items.find((i) => i.traceId === "no-episode")?.priority).toBeNull();
    expect(await claimOrder(q.id)).toEqual(["ambiguous", "clear-ok", "clear-fail", "no-episode"]);
  });

  it("cambiar una cola a `uncertainty` solo afecta a lo que se añada después", async () => {
    const q = await newQueue();
    await service.addItems(ana, q.id, { traceIds: ["clear-ok"] });
    await service.update("e1", q.id, { prioritization: "uncertainty" });
    await service.addItems(ana, q.id, { traceIds: ["ambiguous"] });
    expect(queues.items.map((i) => [i.traceId, i.priority])).toEqual([["clear-ok", null], ["ambiguous", 1]]);
    expect(await claimOrder(q.id)).toEqual(["ambiguous", "clear-ok"]);
  });
});
