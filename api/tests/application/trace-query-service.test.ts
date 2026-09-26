import { describe, expect, it } from "vitest";
import { TraceQueryService } from "@/application/trace-query-service";
import { TraceNotFoundError, ValidationError } from "@/domain/errors";
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
