import { beforeEach, describe, expect, it } from "vitest";
import { UserFeedbackService } from "@/application/user-feedback-service";
import { SpanNotFoundError, TraceNotFoundError, UserFeedbackValueError } from "@/domain/errors";
import type { Annotation } from "@/domain/annotation";
import { FakeAnnotationRepository, FakeScoreConfigRepository, FakeTraceRepository, FakeUserFeedbackRepository, span } from "../helpers";

const SERVICE = "agent-a";
const NOW = new Date("2026-10-06T10:00:00.000Z");

function annotation(traceId: string, value: string): Annotation {
  return { traceId, spanId: null, configId: "cfg", configName: "helpful", dataType: "boolean", annotatorId: "u1", value, comment: null, createdAt: NOW.toISOString() };
}

describe("UserFeedbackService", () => {
  let feedback: FakeUserFeedbackRepository;
  let annotations: FakeAnnotationRepository;
  let traces: FakeTraceRepository;
  let service: UserFeedbackService;

  beforeEach(() => {
    feedback = new FakeUserFeedbackRepository();
    annotations = new FakeAnnotationRepository();
    traces = new FakeTraceRepository();
    traces.traces.set("t1", { spans: [span({ spanId: "aaaaaaaaaaaaaaaa", serviceName: SERVICE })], truncated: false });
    service = new UserFeedbackService(feedback, annotations, new FakeScoreConfigRepository(), traces, () => NOW);
  });

  it("stores a vote with the server clock and trims the optional fields", async () => {
    const vote = await service.submit(SERVICE, "t1", { rating: 1, comment: "  great  ", endUserId: " u-9 ", externalMessageId: "msg-1" });
    expect(vote).toMatchObject({ traceId: "t1", spanId: null, rating: 1, comment: "great", endUserId: "u-9", externalMessageId: "msg-1", createdAt: NOW.toISOString() });
    expect(await feedback.listForTrace(SERVICE, "t1")).toHaveLength(1);
  });

  it("lets the same end user change their mind, and anonymous votes dedupe per trace", async () => {
    await service.submit(SERVICE, "t1", { rating: 1, endUserId: "u-9" });
    await service.submit(SERVICE, "t1", { rating: -1, endUserId: "u-9" });
    await service.submit(SERVICE, "t1", { rating: 1 });
    await service.submit(SERVICE, "t1", { rating: -1 });
    const votes = await feedback.listForTrace(SERVICE, "t1");
    expect(votes.map((v) => [v.endUserId, v.rating])).toEqual([["u-9", -1], [null, -1]]);
  });

  it("rejects an invalid rating", async () => {
    await expect(service.submit(SERVICE, "t1", { rating: 5 })).rejects.toBeInstanceOf(UserFeedbackValueError);
    expect(feedback.rows).toEqual([]);
  });

  it("does not accept traces that belong to another tenant", async () => {
    await expect(service.submit("other-agent", "t1", { rating: 1 })).rejects.toBeInstanceOf(TraceNotFoundError);
    expect(feedback.rows).toEqual([]);
  });

  it("accepts a vote for a trace that is not ingested yet (the SDK exports in batches)", async () => {
    await expect(service.submit(SERVICE, "not-yet", { rating: 1 })).resolves.toMatchObject({ traceId: "not-yet" });
  });

  it("validates the span when the trace is complete", async () => {
    await expect(service.submit(SERVICE, "t1", { rating: 1, spanId: "bbbbbbbbbbbbbbbb" })).rejects.toBeInstanceOf(SpanNotFoundError);
    await expect(service.submit(SERVICE, "t1", { rating: 1, spanId: "aaaaaaaaaaaaaaaa" })).resolves.toMatchObject({ spanId: "aaaaaaaaaaaaaaaa" });
  });

  it("retracts a vote and is idempotent", async () => {
    await service.submit(SERVICE, "t1", { rating: -1, endUserId: "u-9" });
    await service.retract(SERVICE, "t1", { endUserId: "u-9" });
    await service.retract(SERVICE, "t1", { endUserId: "u-9" });
    expect(await feedback.listForTrace(SERVICE, "t1")).toEqual([]);
  });

  it("flags a thumbs down on a well-rated trace as misaligned, and agrees once a reviewer rates it badly", async () => {
    await service.submit(SERVICE, "t1", { rating: -1 });
    await annotations.upsert(SERVICE, annotation("t1", "true"));
    expect((await service.listForTrace("e1", SERVICE, "t1")).alignment).toBe("misaligned");
    await annotations.upsert(SERVICE, { ...annotation("t1", "false"), annotatorId: "u2" });
    expect((await service.listForTrace("e1", SERVICE, "t1")).alignment).toBe("aligned"); // una etiqueta mala hace malo el veredicto y el usuario dio 👎: ahora coinciden
  });

  it("reports unknown alignment when nobody reviewed the trace", async () => {
    await service.submit(SERVICE, "t1", { rating: 1 });
    expect((await service.listForTrace("e1", SERVICE, "t1")).alignment).toBe("unknown");
  });

  it("summarises votes per trace for list columns, only for ids with votes", async () => {
    await service.submit(SERVICE, "t1", { rating: 1, endUserId: "a" });
    await service.submit(SERVICE, "t1", { rating: -1, endUserId: "b" });
    expect(await service.listRatings(SERVICE, { traceIds: ["t1", "t2"] })).toEqual([{ id: "t1", up: 1, down: 1 }]);
  });

  it("builds the overview of a range", async () => {
    await service.submit(SERVICE, "t1", { rating: -1, comment: "wrong city" });
    await annotations.upsert(SERVICE, annotation("t1", "true"));
    const overview = await service.overview("e1", SERVICE, { fromMs: NOW.getTime() - 86_400_000, toMs: NOW.getTime() + 1000 });
    expect(overview.summary).toMatchObject({ total: 1, up: 0, down: 1, satisfaction: 0, ratedTraces: 1 });
    expect(overview.days).toEqual([{ day: "2026-10-06", up: 0, down: 1 }]);
    expect(overview.alignment).toEqual({ aligned: 0, misaligned: 1 });
    expect(overview.recentDown).toEqual([{ traceId: "t1", comment: "wrong city", createdAt: NOW.toISOString() }]);
  });
});
