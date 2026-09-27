import { describe, expect, it } from "vitest";
import { TraceQueryService } from "@/application/trace-query-service";
import { ConversationNotFoundError, TraceNotFoundError, ValidationError } from "@/domain/errors";
import { FakeTraceRepository, emptyOverview, span } from "../helpers";

const NOW = Date.parse("2026-09-26T12:00:00Z");

function setup() {
  const repo = new FakeTraceRepository();
  return { repo, service: new TraceQueryService(repo, () => NOW) };
}

describe("TraceQueryService", () => {
  it("lists traces with the default range and page size", async () => {
    const { repo, service } = setup();
    await service.listTraces({});
    expect(repo.lastListQuery).toMatchObject({ limit: 50, toMs: NOW });
    expect(repo.lastListQuery!.toMs - repo.lastListQuery!.fromMs).toBe(24 * 3600_000);
  });

  it.each([0, 201, 1.5])("rejects limit %s", (limit) => {
    const { service } = setup();
    expect(() => service.listTraces({ limit })).toThrow(ValidationError);
  });

  it("throws TraceNotFoundError for unknown or empty traces", async () => {
    const { repo, service } = setup();
    await expect(service.getTrace("nope")).rejects.toBeInstanceOf(TraceNotFoundError);
    repo.traces.set("empty", { spans: [], truncated: false });
    await expect(service.getTrace("empty")).rejects.toBeInstanceOf(TraceNotFoundError);
  });

  it("builds the tree of an existing trace", async () => {
    const { repo, service } = setup();
    const root = span({ spanId: "r" });
    repo.traces.set("t", { spans: [span({ parentSpanId: "r" }), root], truncated: true });
    const detail = await service.getTrace("t");
    expect(detail.roots).toHaveLength(1);
    expect(detail.truncated).toBe(true);
  });

  it("builds one span tree per turn, in the same order, skipping turns with no spans", async () => {
    const { repo, service } = setup();
    repo.conversations.set("c1", {
      conversationId: "c1", serviceNames: ["svc"], startTimeUs: 1, lastActivityUs: 2,
      turnCount: 2, errorTurns: 0, failedSpans: 0, totalTokens: 0, activeMs: 0,
    });
    repo.page = {
      items: [
        { traceId: "t1", rootSpanName: "turno 1", serviceName: "svc", startTimeUs: 1, durationMs: 5, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0, input: null, output: null, conversationId: "c1" },
        { traceId: "t2", rootSpanName: "turno 2", serviceName: "svc", startTimeUs: 2, durationMs: 5, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0, input: null, output: null, conversationId: "c1" },
      ],
      nextCursor: null,
    };
    repo.traces.set("t1", { spans: [span({ spanId: "t1" })], truncated: false });
    // t2 sin spans: llegó a listTraces pero desapareció del almacén de spans; no debe romper la respuesta

    const page = await service.getConversationTraceTrees("c1");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.traceId).toBe("t1");

    await expect(service.getConversationTraceTrees("nope")).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it("fills the overview timeseries and passes a computed bucket size", async () => {
    const { repo, service } = setup();
    repo.overview = { ...emptyOverview, bucketSeconds: 1 }; // un repositorio no puede imponer el bucket
    const overview = await service.getOverview({ service: "svc" });
    expect(repo.lastOverviewQuery).toMatchObject({ service: "svc", bucketSeconds: 1440 });
    expect(overview.bucketSeconds).toBe(1440);
    expect(overview.timeseries).toHaveLength(60);
    expect(overview.toMs).toBe(NOW);
  });
});
