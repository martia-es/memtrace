import { describe, expect, it } from "vitest";
import { TraceQueryService } from "@/application/trace-query-service";
import { ConversationNotFoundError, TraceNotFoundError, ValidationError } from "@/domain/errors";
import { FakeTraceRepository, SCOPE, emptyOverview, span } from "../helpers";

const NOW = Date.parse("2026-09-26T12:00:00Z");

function setup() {
  const repo = new FakeTraceRepository();
  return { repo, service: new TraceQueryService(repo, () => NOW) };
}

describe("TraceQueryService", () => {
  it("passes the revision filter to the repository (ADR-065)", async () => {
    const { repo, service } = setup();
    await service.listTraces({ scope: SCOPE, revision: "3a08213" });
    expect(repo.lastListQuery).toMatchObject({ revision: "3a08213" });
  });

  it("lists traces with the default range and page size", async () => {
    const { repo, service } = setup();
    await service.listTraces({ scope: SCOPE });
    expect(repo.lastListQuery).toMatchObject({ limit: 50, toMs: NOW });
    expect(repo.lastListQuery!.toMs - repo.lastListQuery!.fromMs).toBe(24 * 3600_000);
  });

  it.each([0, 201, 1.5])("rejects limit %s", (limit) => {
    const { service } = setup();
    expect(() => service.listTraces({ scope: SCOPE, limit })).toThrow(ValidationError);
  });

  it("throws TraceNotFoundError for unknown or empty traces", async () => {
    const { repo, service } = setup();
    await expect(service.getTrace(SCOPE, "nope")).rejects.toBeInstanceOf(TraceNotFoundError);
    repo.traces.set("empty", { spans: [], truncated: false });
    await expect(service.getTrace(SCOPE, "empty")).rejects.toBeInstanceOf(TraceNotFoundError);
  });

  it("builds the tree of an existing trace", async () => {
    const { repo, service } = setup();
    const root = span({ spanId: "r" });
    repo.traces.set("t", { spans: [span({ parentSpanId: "r" }), root], truncated: true });
    const detail = await service.getTrace(SCOPE, "t");
    expect(detail.roots).toHaveLength(1);
    expect(detail.truncated).toBe(true);
  });

  it("builds one span tree per turn, in the same order, skipping turns with no spans", async () => {
    const { repo, service } = setup();
    repo.conversations.set("c1", {
      conversationId: "c1", serviceNames: ["svc"], startTimeUs: 1, lastActivityUs: 2,
      turnCount: 2, errorTurns: 0, failedSpans: 0, totalTokens: 0, activeMs: 0, prompts: [],
    });
    repo.page = {
      items: [
        { traceId: "t1", rootSpanName: "turno 1", serviceName: "svc", startTimeUs: 1, durationMs: 5, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0, input: null, output: null, error: null, conversationId: "c1", revision: null, prompts: [] },
        { traceId: "t2", rootSpanName: "turno 2", serviceName: "svc", startTimeUs: 2, durationMs: 5, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0, input: null, output: null, error: null, conversationId: "c1", revision: null, prompts: [] },
      ],
      nextCursor: null,
    };
    repo.traces.set("t1", { spans: [span({ spanId: "t1" })], truncated: false });
    // t2 sin spans: llegó a listTraces pero desapareció del almacén de spans; no debe romper la respuesta

    const page = await service.getConversationTraceTrees(SCOPE, "c1");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.traceId).toBe("t1");

    await expect(service.getConversationTraceTrees(SCOPE, "nope")).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it("fills the overview timeseries and passes a computed bucket size", async () => {
    const { repo, service } = setup();
    repo.overview = { ...emptyOverview, bucketSeconds: 1 }; // un repositorio no puede imponer el bucket
    const overview = await service.getOverview({ scope: SCOPE });
    expect(repo.lastOverviewQuery).toMatchObject({ scope: SCOPE, bucketSeconds: 1440 });
    expect(overview.bucketSeconds).toBe(1440);
    expect(overview.timeseries).toHaveLength(60);
    expect(overview.toMs).toBe(NOW);
  });

  it("prices each trace's tokens per model and leaves cost null when no model has a price (ADR-044)", async () => {
    const { repo, service } = setup();
    repo.modelPricing = [{ modelId: "gpt-x", provider: "openai", inputPricePerToken: 0.001, outputPricePerToken: 0.002, source: "litellm", updatedAtMs: 0 }];
    repo.traceStats.set("priced", { traceId: "priced", durationMs: 1500, byModel: [{ model: "gpt-x", inputTokens: 100, outputTokens: 50 }, { model: "unknown", inputTokens: 10, outputTokens: 5 }], prompts: [{ name: "weather-system", version: 2 }] });
    repo.traceStats.set("unpriced", { traceId: "unpriced", durationMs: 200, byModel: [{ model: "unknown", inputTokens: 10, outputTokens: 5 }], prompts: [] });

    const telemetry = await service.getItemTelemetry(SCOPE, ["priced", "unpriced", "priced", "missing"]);

    expect(telemetry.get("priced")).toEqual({ latencyMs: 1500, inputTokens: 110, outputTokens: 55, costUsd: 0.2, prompts: [{ name: "weather-system", version: 2 }] });
    expect(telemetry.get("unpriced")).toMatchObject({ latencyMs: 200, costUsd: null });
    expect(telemetry.has("missing")).toBe(false);
  });

  it("does not query the store when there are no trace ids", async () => {
    const { repo, service } = setup();
    repo.failWith = new Error("must not be called");
    expect((await service.getItemTelemetry(SCOPE, [])).size).toBe(0);
  });
});

describe("TraceQueryService.getErrorOverview (ADR-066)", () => {
  it("compares with the immediately preceding period of the same length", async () => {
    const { repo, service } = setup();
    const out = await service.getErrorOverview({ scope: SCOPE });
    expect(repo.lastErrorQueries).toHaveLength(2);
    const [current, previous] = repo.lastErrorQueries;
    expect(current).toMatchObject({ toMs: NOW, scope: SCOPE });
    expect(previous!.toMs).toBe(current!.fromMs);
    expect(previous!.toMs - previous!.fromMs).toBe(current!.toMs - current!.fromMs);
    expect(out.previousRange).toEqual(previous && { fromMs: previous.fromMs, toMs: previous.toMs });
  });

  it("skips the comparison when the previous period is older than the retention", async () => {
    const { repo, service } = setup();
    const out = await service.getErrorOverview({ scope: SCOPE, from: new Date(NOW - 20 * 24 * 3600_000) });
    expect(repo.lastErrorQueries).toHaveLength(1);
    expect(out.previousRange).toBeNull();
  });
});
