import { describe, expect, it } from "vitest";
import { toAnnotationQueuesListResponse, toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { addQueueItemsBody, completeQueueItemBody, createAnnotationQueueBody } from "@/adapters/inbound/http/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("addQueueItemsBody", () => {
  it("accepts exactly one of the three forms", () => {
    expect(addQueueItemsBody.safeParse({ traceIds: ["a"] }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ fromFilter: { hasErrors: true, from: "2026-10-01T00:00:00Z", limit: 50 } }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ runItems: [{ datasetRunId: uuid, itemIndex: 0 }] }).success).toBe(true);
  });
  it("rejects mixing forms, oversized batches and malformed run items", () => {
    expect(addQueueItemsBody.safeParse({ traceIds: ["a"], runItems: [] }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ traceIds: Array(501).fill("a") }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromFilter: { limit: 501 } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ runItems: [{ datasetRunId: "nope", itemIndex: 0 }] }).success).toBe(false);
  });
});

describe("addQueueItemsBody — sampling (ADR-040)", () => {
  it("accepts a sample of a run, with or without a seed", () => {
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid } }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 50 } } }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 50, seed: "abc" } } }).success).toBe(true);
  });

  it("accepts a filter with exactly one of limit or sample", () => {
    expect(addQueueItemsBody.safeParse({ fromFilter: { hasErrors: true, sample: { size: 30 } } }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ fromFilter: { hasErrors: true, limit: 30 } }).success).toBe(true);
    expect(addQueueItemsBody.safeParse({ fromFilter: { hasErrors: true } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromFilter: { limit: 30, sample: { size: 30 } } }).success).toBe(false);
  });

  it("rejects an out-of-range sample size, an empty seed and unknown sample fields", () => {
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 0 } } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 501 } } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 5, seed: "" } } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: uuid, sample: { size: 5, rate: 0.1 } } }).success).toBe(false);
    expect(addQueueItemsBody.safeParse({ fromRun: { datasetRunId: "nope" } }).success).toBe(false);
  });
});

describe("queue bodies", () => {
  it("defaults requiredAnnotations to 1 and each rubric entry to required", () => {
    const body = createAnnotationQueueBody.parse({ name: "q", reviewerIds: [uuid], rubric: [{ configId: uuid }] });
    expect(body).toMatchObject({ requiredAnnotations: 1, instructions: null, rubric: [{ configId: uuid, required: true }] });
  });
  it("accepts numeric, boolean and string label values", () => {
    expect(completeQueueItemBody.safeParse({ labels: [{ configId: uuid, value: 3 }, { configId: uuid, value: false }, { configId: uuid, value: "x" }] }).success).toBe(true);
  });
});

describe("queue mappers", () => {
  it("never exposes who added an item or the creator", () => {
    const dto = toQueueItemDto({
      id: "i", queueId: "q", targetType: "trace", traceId: "t", datasetRunId: null, itemIndex: null, status: "pending", population: "manual", sampleSeed: null, addedBy: "secret-user", addedAt: "x", completedAt: null,
    });
    expect(JSON.stringify(dto)).not.toContain("secret-user");
    const list = toAnnotationQueuesListResponse([
      { queue: { id: "q", experimentId: "e", name: "n", instructions: null, requiredAnnotations: 1, reviewerIds: [], rubric: [], createdBy: "secret-user", createdAt: "x", archivedAt: null }, progress: { pending: 1, completed: 0, skipped: 0 }, toCurate: 0, assignedReviewers: [], isReviewer: false },
    ]);
    expect(JSON.stringify(list)).not.toContain("secret-user");
  });
});
