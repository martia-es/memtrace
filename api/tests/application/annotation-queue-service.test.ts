import { beforeEach, describe, expect, it } from "vitest";
import { AnnotationQueueService } from "@/application/annotation-queue-service";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import { RepositoryUnavailableError } from "@/application/errors";
import { AnnotationQueueInvariantError, AnnotationQueueNotFoundError, AnnotationQueueReviewerError, ScoreConfigNotFoundError, ValidationError } from "@/domain/errors";
import { FakeAnnotationQueueRepository, FakeAnnotationRepository, FakeScoreConfigRepository, FakeTraceRepository, span } from "../helpers";

const SERVICE = "svc";
const ana = { userId: "ana", experimentId: "e1", serviceName: SERVICE };
const luis = { userId: "luis", experimentId: "e1", serviceName: SERVICE };

describe("AnnotationQueueService (ADR-039)", () => {
  let queues: FakeAnnotationQueueRepository;
  let configs: FakeScoreConfigRepository;
  let annotations: FakeAnnotationRepository;
  let traces: FakeTraceRepository;
  let runs: Array<{ id: string; itemCount: number }>;
  let promoted: Array<{ traceId: string; datasetId: string; datasetName: string; version: string }>;
  let service: AnnotationQueueService;
  let toneId: string;
  let queueId: string;

  beforeEach(async () => {
    queues = new FakeAnnotationQueueRepository();
    configs = new FakeScoreConfigRepository();
    annotations = new FakeAnnotationRepository();
    traces = new FakeTraceRepository();
    for (const id of ["t1", "t2", "t3"]) traces.traces.set(id, { spans: [span({ serviceName: SERVICE })], truncated: false });
    traces.traces.set("foreign", { spans: [span({ serviceName: "other" })], truncated: false });
    runs = [{ id: "run-1", itemCount: 3 }];
    promoted = [];
    const identity = {
      getUsersByIds: async (ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.com`, image: `https://img/${id}.png` })),
      listRunsForExperiment: async () => runs,
      getExperiment: async () => ({ id: "e1", organizationId: "org-1" }),
      listOrgMembers: async () => [{ userId: "olga", email: "olga@x.com", name: "Olga", role: "org_admin" }],
      findPromotedTraces: async (_experimentId: string, traceIds: string[]) => promoted.filter((p) => traceIds.includes(p.traceId)),
      listExperimentMembers: async () => ["ana", "luis", "bea", "eva"].map((userId) => ({ userId, email: `${userId}@x.com`, name: userId, role: "member" })),
    } as unknown as IdentityRepository;
    service = new AnnotationQueueService(queues, configs, annotations, traces, identity, () => new Date("2026-10-03T10:00:00.000Z"));
    toneId = (await configs.create("e1", "u1", { name: "tone", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, description: null })).id;
    queueId = (await service.create("e1", "u1", { name: "Review", instructions: null, requiredAnnotations: 1, reviewerIds: ["ana", "luis"], rubric: [{ configId: toneId, required: true }] })).id;
  });

  describe("queues", () => {
    it("rejects a rubric config that does not exist in the experiment or is archived", async () => {
      await expect(service.create("e1", "u1", { name: "x", instructions: null, requiredAnnotations: 1, reviewerIds: ["ana", "luis"], rubric: [{ configId: "nope", required: true }] })).rejects.toBeInstanceOf(ScoreConfigNotFoundError);
      await configs.setArchived("e1", toneId, true);
      await expect(service.create("e1", "u1", { name: "x", instructions: null, requiredAnnotations: 1, reviewerIds: ["ana", "luis"], rubric: [{ configId: toneId, required: true }] })).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
    });

    it("lists each queue with the name and photo of its reviewers, never their email", async () => {
      const [listed] = await service.list("e1", "ana");
      expect(listed!.assignedReviewers).toEqual([
        { userId: "ana", name: "ANA", image: "https://img/ana.png" },
        { userId: "luis", name: "LUIS", image: "https://img/luis.png" },
      ]);
    });

    it("offers only the experiment's members as reviewers: an org_admin has no annotation permission (ADR-052)", async () => {
      const candidates = await service.reviewerCandidates("e1");
      expect(candidates.map((c) => c.userId).sort()).toEqual(["ana", "bea", "eva", "luis"]);
      await expect(service.update("e1", queueId, { reviewerIds: ["ana", "olga"] })).rejects.toBeInstanceOf(ValidationError);
    });

    it("tells each person whether they can annotate in a queue", async () => {
      expect((await service.list("e1", "ana"))[0]!.isReviewer).toBe(true);
      expect((await service.list("e1", "bea"))[0]!.isReviewer).toBe(false);
    });

    it("rejects reviewers that are not members of the experiment", async () => {
      await expect(service.create("e1", "u1", { name: "x", instructions: null, requiredAnnotations: 1, reviewerIds: ["ana", "stranger"], rubric: [{ configId: toneId, required: true }] })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.update("e1", queueId, { reviewerIds: ["stranger"] })).rejects.toBeInstanceOf(ValidationError);
    });

    it("only lets the assigned reviewers pull, complete and skip, even other experiment members", async () => {
      await service.addItems(ana, queueId, { traceIds: ["t1"] });
      const bea = { userId: "bea", experimentId: "e1", serviceName: SERVICE };
      await expect(service.next(bea, queueId)).rejects.toBeInstanceOf(AnnotationQueueReviewerError);
      const item = (await service.next(ana, queueId))!;
      await expect(service.skip(bea, queueId, item.id)).rejects.toBeInstanceOf(AnnotationQueueReviewerError);
      await expect(service.complete(bea, queueId, item.id, [{ configId: toneId, value: 3 }])).rejects.toBeInstanceOf(AnnotationQueueReviewerError);
      await service.update("e1", queueId, { reviewerIds: ["ana", "bea"] });
      expect(await service.next(bea, queueId)).toBeNull();
    });

    it("does not leak queues across experiments", async () => {
      await expect(service.getDetail("e2", queueId)).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);
    });

    it("allows growing the rubric but not shrinking it once there are items", async () => {
      const noteId = (await configs.create("e1", "u1", { name: "note", dataType: "boolean", minValue: null, maxValue: null, categories: null, description: null })).id;
      await service.update("e1", queueId, { rubric: [{ configId: toneId, required: true }, { configId: noteId, required: false }] });
      await service.addItems(ana, queueId, { traceIds: ["t1"] });
      await expect(service.update("e1", queueId, { rubric: [{ configId: noteId, required: true }] })).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
    });
  });

  describe("addItems", () => {
    it("adds traces, drops duplicates and verifies the tenant in a single batch", async () => {
      expect(await service.addItems(ana, queueId, { traceIds: ["t1", "t1", "t2"] })).toEqual({ added: 2, duplicates: 0 });
      expect(await service.addItems(ana, queueId, { traceIds: ["t2", "t3"] })).toEqual({ added: 1, duplicates: 1 });
    });

    it("rejects the whole request when a trace is unknown or from another tenant", async () => {
      await expect(service.addItems(ana, queueId, { traceIds: ["t1", "foreign"] })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.addItems(ana, queueId, { traceIds: ["t1", "missing"] })).rejects.toBeInstanceOf(ValidationError);
      expect(queues.items).toEqual([]);
    });

    it("snapshots the traces matching a filter, scoped to the experiment's service", async () => {
      traces.page = { items: ["t1", "t2"].map((traceId) => ({ traceId }) as never), nextCursor: null };
      expect(await service.addItems(ana, queueId, { fromFilter: { hasErrors: true, limit: 10 } })).toEqual({ added: 2, duplicates: 0 });
      expect(traces.lastListQuery).toMatchObject({ service: SERVICE, hasErrors: true });
    });

    it("adds run items only for runs of the experiment and indexes inside the run", async () => {
      expect(await service.addItems(ana, queueId, { runItems: [{ datasetRunId: "run-1", itemIndex: 2 }] })).toEqual({ added: 1, duplicates: 0 });
      await expect(service.addItems(ana, queueId, { runItems: [{ datasetRunId: "run-1", itemIndex: 3 }] })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.addItems(ana, queueId, { runItems: [{ datasetRunId: "other", itemIndex: 0 }] })).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses to add to an archived queue", async () => {
      await service.update("e1", queueId, { archived: true });
      await expect(service.addItems(ana, queueId, { traceIds: ["t1"] })).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
    });
  });

  describe("pull, complete and skip", () => {
    beforeEach(async () => {
      await service.addItems(ana, queueId, { traceIds: ["t1", "t2"] });
    });

    it("hands out items in order and resumes the unfinished one", async () => {
      const first = await service.next(ana, queueId);
      expect(first?.traceId).toBe("t1");
      expect((await service.next(ana, queueId))?.id).toBe(first?.id);
      expect((await service.next(luis, queueId))?.traceId).toBe("t2");
    });

    it("returns null when nothing is left for the reviewer", async () => {
      await service.next(ana, queueId);
      await service.next(luis, queueId);
      await service.update("e1", queueId, { reviewerIds: ["ana", "luis", "eva"] });
      expect(await service.next({ ...ana, userId: "eva" }, queueId)).toBeNull();
    });

    it("complete writes the labels to ClickHouse first and then closes the claim", async () => {
      const item = (await service.next(ana, queueId))!;
      const done = await service.complete(ana, queueId, item.id, [{ configId: toneId, value: 4, comment: "ok" }]);
      expect(done.status).toBe("completed");
      expect(annotations.rows[0]?.annotation).toMatchObject({ traceId: "t1", annotatorId: "ana", configId: toneId, value: "4", comment: "ok" });
      expect(await service.next(ana, queueId)).toMatchObject({ traceId: "t2" });
    });

    it("keeps the item open and the labels written when the Postgres step fails; a retry succeeds without duplicates", async () => {
      const item = (await service.next(ana, queueId))!;
      queues.failCompleteWith = new RepositoryUnavailableError();
      await expect(service.complete(ana, queueId, item.id, [{ configId: toneId, value: 4 }])).rejects.toBeInstanceOf(RepositoryUnavailableError);
      expect(annotations.rows).toHaveLength(1);
      expect(queues.items[0]?.status).toBe("pending");

      queues.failCompleteWith = undefined;
      expect((await service.complete(ana, queueId, item.id, [{ configId: toneId, value: 4 }])).status).toBe("completed");
      expect(annotations.rows).toHaveLength(1);
    });

    it("persists nothing when validation fails", async () => {
      const item = (await service.next(ana, queueId))!;
      await expect(service.complete(ana, queueId, item.id, [])).rejects.toBeInstanceOf(ValidationError);
      await expect(service.complete(ana, queueId, item.id, [{ configId: toneId, value: 99 }])).rejects.toThrow();
      expect(annotations.rows).toEqual([]);
      expect(queues.claims.every((c) => !c.completed)).toBe(true);
    });

    it("requires having pulled the item first", async () => {
      const item = queues.items[0]!;
      await expect(service.complete(luis, queueId, item.id, [{ configId: toneId, value: 3 }])).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
      await expect(service.skip(luis, queueId, item.id)).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
    });

    it("writes run item labels against the run and index, not as trace labels", async () => {
      await service.addItems(ana, queueId, { runItems: [{ datasetRunId: "run-1", itemIndex: 1 }] });
      await service.complete(ana, queueId, (await service.next(ana, queueId))!.id, [{ configId: toneId, value: 2 }]);
      await service.complete(ana, queueId, (await service.next(ana, queueId))!.id, [{ configId: toneId, value: 2 }]);
      const run = (await service.next(ana, queueId))!;
      expect(run).toMatchObject({ targetType: "run_item" });
      await service.complete(ana, queueId, run.id, [{ configId: toneId, value: 5 }]);
      expect(annotations.rows.at(-1)?.annotation).toMatchObject({ datasetRunId: "run-1", itemIndex: 1, traceId: "" });
      expect(await annotations.listForTrace(SERVICE, "")).toEqual([]);
    });

    it("skip returns the item to the pool for others but not for the same reviewer", async () => {
      const item = (await service.next(ana, queueId))!;
      await service.skip(ana, queueId, item.id);
      expect((await service.next(ana, queueId))?.traceId).toBe("t2");
      expect((await service.next(luis, queueId))?.id).toBe(item.id);
    });

    it("a skipped-by-admin item is not handed out and cannot be completed", async () => {
      const item = (await service.next(ana, queueId))!;
      await service.markUnreviewable("e1", queueId, item.id);
      await expect(service.complete(ana, queueId, item.id, [{ configId: toneId, value: 3 }])).rejects.toBeInstanceOf(AnnotationQueueInvariantError);
      expect((await service.getDetail("e1", queueId)).progress.skipped).toBe(1);
    });
  });

  describe("multiple annotations per item", () => {
    beforeEach(async () => {
      await service.update("e1", queueId, { requiredAnnotations: 2 });
      await service.addItems(ana, queueId, { traceIds: ["t1"] });
    });

    it("needs two different reviewers before the item is completed", async () => {
      const item = (await service.next(ana, queueId))!;
      expect((await service.complete(ana, queueId, item.id, [{ configId: toneId, value: 4 }])).status).toBe("pending");
      expect(await service.next(ana, queueId)).toBeNull();
      expect((await service.next(luis, queueId))?.id).toBe(item.id);
      expect((await service.complete(luis, queueId, item.id, [{ configId: toneId, value: 2 }])).status).toBe("completed");
      expect(annotations.rows.map((r) => r.annotation.annotatorId).sort()).toEqual(["ana", "luis"]);
    });

    it("raising the requirement reopens completed items and lowering it completes them", async () => {
      await service.update("e1", queueId, { requiredAnnotations: 1 });
      const item = (await service.next(ana, queueId))!;
      await service.complete(ana, queueId, item.id, [{ configId: toneId, value: 4 }]);
      expect((await service.getDetail("e1", queueId)).progress).toEqual({ pending: 0, completed: 1, skipped: 0 });
      await service.update("e1", queueId, { requiredAnnotations: 2 });
      expect((await service.getDetail("e1", queueId)).progress).toEqual({ pending: 1, completed: 0, skipped: 0 });
      // Ana ya revisó este item: no puede volver a cogerlo, hace falta otra persona
      expect(await service.next(ana, queueId)).toBeNull();
      await service.update("e1", queueId, { requiredAnnotations: 1 });
      expect((await service.getDetail("e1", queueId)).progress.completed).toBe(1);
    });
  });

  it("reports per-reviewer progress with display names", async () => {
    await service.addItems(ana, queueId, { traceIds: ["t1"] });
    await service.complete(ana, queueId, (await service.next(ana, queueId))!.id, [{ configId: toneId, value: 3 }]);
    expect((await service.getDetail("e1", queueId)).reviewers).toEqual([{ userId: "ana", name: "ANA", completed: 1, skipped: 0, inProgress: 0 }]);
  });
  describe("results and resolutions (ADR-050)", () => {
    const label = (userId: string, traceId: string, value: string, comment: string | null = null) => ({
      traceId, spanId: null, configId: toneId, configName: "tone", dataType: "numeric" as const, annotatorId: userId, value, comment, createdAt: "2026-10-04T10:00:00.000Z",
    });

    async function twoReviewedItems() {
      const q = await service.create("e1", "u1", { name: "Two", instructions: null, requiredAnnotations: 2, reviewerIds: ["ana", "luis"], rubric: [{ configId: toneId, required: true }] });
      await service.addItems(ana, q.id, { traceIds: ["t1", "t2"] });
      await annotations.upsert(SERVICE, label("ana", "t1", "5", "great"));
      await annotations.upsert(SERVICE, label("luis", "t1", "4"));
      await annotations.upsert(SERVICE, label("ana", "t2", "1"));
      await annotations.upsert(SERVICE, label("luis", "t2", "5"));
      return q.id;
    }

    it("returns every reviewer's label per item and criterion, flagging disagreements", async () => {
      const id = await twoReviewedItems();
      const results = await service.getResults(ana, id);
      expect(results.total).toBe(2);
      const [t1, t2] = results.items;
      expect(t1!.item.traceId).toBe("t1");
      expect(t1!.criteria[0]!.status).toBe("consensus");
      expect(t1!.criteria[0]!.labels.map((l) => [l.name, l.value, l.comment])).toEqual([["ANA", "5", "great"], ["LUIS", "4", null]]);
      expect(t2!.criteria[0]!.status).toBe("disagreement");
      expect(t2!.needsResolution).toBe(true);
    });

    it("says which dataset already holds an item promoted from each trace", async () => {
      const id = await twoReviewedItems();
      promoted = [{ traceId: "t1", datasetId: "d1", datasetName: "Regression", version: "3.0" }];
      const [t1, t2] = (await service.getResults(ana, id)).items;
      expect(t1!.promotedTo).toEqual(promoted);
      expect(t2!.promotedTo).toEqual([]);
    });

    it("lists the queues a trace belongs to with the item status", async () => {
      const id = await twoReviewedItems();
      expect(await service.queuesForTrace("e1", "t1")).toEqual([{ queueId: id, queueName: "Two", archived: false, itemStatus: "pending" }]);
      expect(await service.queuesForTrace("e1", "nope")).toEqual([]);
    });

    it("filters to disagreements and paginates after filtering", async () => {
      const id = await twoReviewedItems();
      const only = await service.getResults(ana, id, { onlyDisagreements: true });
      expect(only.items.map((i) => i.item.traceId)).toEqual(["t2"]);
      expect(only.total).toBe(1);
      const page = await service.getResults(ana, id, { limit: 1, offset: 1 });
      expect(page.items.map((i) => i.item.traceId)).toEqual(["t2"]);
      expect(page.total).toBe(2);
    });

    it("marks labels of people removed from the reviewer list but keeps them", async () => {
      const id = await twoReviewedItems();
      await service.update("e1", id, { reviewerIds: ["ana", "bea"], requiredAnnotations: 1 });
      const [t1] = (await service.getResults(ana, id)).items;
      expect(t1!.criteria[0]!.labels.map((l) => [l.name, l.isReviewer])).toEqual([["ANA", true], ["LUIS", false]]);
    });

    it("stores a resolution apart from the labels and stops flagging the item", async () => {
      const id = await twoReviewedItems();
      const t2 = (await service.getResults(ana, id)).items[1]!;
      const saved = await service.resolve("e1", "tech", id, t2.item.id, { configId: toneId, value: 2, expectedOutput: "  Hoy no llueve  " });
      expect(saved).toMatchObject({ value: "2", expectedOutput: "Hoy no llueve", resolvedBy: "tech" });
      const after = (await service.getResults(ana, id)).items[1]!;
      expect(after.needsResolution).toBe(false);
      expect(after.criteria[0]!.resolution?.value).toBe("2");
      expect(after.criteria[0]!.labels).toHaveLength(2);
      expect(annotations.rows.filter((r) => r.annotation.annotatorId === "tech")).toEqual([]);
    });

    it("validates the resolution against the rubric config", async () => {
      const id = await twoReviewedItems();
      const item = (await service.getResults(ana, id)).items[0]!.item;
      await expect(service.resolve("e1", "tech", id, item.id, { configId: toneId, value: 9 })).rejects.toBeInstanceOf(Error);
      await expect(service.resolve("e1", "tech", id, item.id, { configId: "other", value: 3 })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.resolve("e1", "tech", id, "missing", { configId: toneId, value: 3 })).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);
    });

    it("clears a resolution and 404s when there is none", async () => {
      const id = await twoReviewedItems();
      const item = (await service.getResults(ana, id)).items[1]!.item;
      await service.resolve("e1", "tech", id, item.id, { configId: toneId, value: 2 });
      await service.clearResolution("e1", id, item.id, toneId);
      expect((await service.getResults(ana, id)).items[1]!.needsResolution).toBe(true);
      await expect(service.clearResolution("e1", id, item.id, toneId)).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);
    });
  });
});
