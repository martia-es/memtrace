import { describe, expect, it } from "vitest";
import { createHandlers } from "@/adapters/inbound/http/handlers";
import { encodeCursor } from "@/adapters/inbound/http/schemas";
import { RepositoryUnavailableError } from "@/application/errors";
import { TraceQueryService } from "@/application/trace-query-service";
import { FakeTraceRepository, span } from "../helpers";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const TRACE_ID = "8791d6e0a1b2c3d4e5f60718293a4b5c";

function setup() {
  const repo = new FakeTraceRepository();
  const handlers = createHandlers(new TraceQueryService(repo, () => NOW));
  return { repo, handlers };
}
const get = (path: string) => new Request(`http://localhost/api/v1${path}`);

describe("GET /traces", () => {
  it("returns items as ISO dates and an opaque cursor that round-trips", async () => {
    const { repo, handlers } = setup();
    const cursor = { startTimeUs: 1_790_000_000_123_456, traceId: TRACE_ID };
    repo.page = {
      items: [{ traceId: TRACE_ID, rootSpanName: "agent", serviceName: "svc", startTimeUs: 1_790_000_000_123_456, durationMs: 12.5, status: "ok", spanCount: 3, errorCount: 0, totalTokens: 7 }],
      nextCursor: cursor,
    };
    const response = await handlers.listTraces(get("/traces"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items[0].startTime).toBe(new Date(1_790_000_000_123).toISOString());
    expect(body.nextCursor).toBe(encodeCursor(cursor));

    await handlers.listTraces(get(`/traces?cursor=${body.nextCursor}&hasErrors=true&status=error&minDurationMs=5&service=svc&limit=10`));
    expect(repo.lastListQuery).toMatchObject({ cursor, hasErrors: true, status: "error", minDurationMs: 5, service: "svc", limit: 10 });
  });

  it.each([
    ["from=nope", "from"],
    ["status=weird", "status"],
    ["limit=500", "limit"],
    ["hasErrors=yes", "hasErrors"],
    ["cursor=%%%", "cursor"],
    ["from=2026-09-26T12:00:00Z&to=2026-09-26T11:00:00Z", "from"],
  ])("rejects invalid query %s with problem+json 400", async (qs, field) => {
    const { handlers } = setup();
    const response = await handlers.listTraces(get(`/traces?${qs}`));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(Object.keys(body.errors)).toContain(field);
  });

  it("maps an unavailable store to 503 without leaking the cause", async () => {
    const { repo, handlers } = setup();
    repo.failWith = new RepositoryUnavailableError(new Error("connect ECONNREFUSED 10.0.0.1:8123"));
    const response = await handlers.listTraces(get("/traces"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("ECONNREFUSED");
  });

  it("maps unexpected errors to a generic 500", async () => {
    const { repo, handlers } = setup();
    repo.failWith = new Error("SELECT * FROM secret");
    const response = await handlers.listTraces(get("/traces"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("GET /traces/{id}", () => {
  it("returns the span tree with ISO times", async () => {
    const { repo, handlers } = setup();
    const root = span({ spanId: "r", startTimeUs: 1_790_000_000_000_000 });
    repo.traces.set(TRACE_ID, { spans: [root, span({ parentSpanId: "r", startTimeUs: 1_790_000_000_500_000 })], truncated: false });
    const response = await handlers.getTrace(get(""), TRACE_ID.toUpperCase());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.roots[0].children).toHaveLength(1);
    expect(body.roots[0].children[0].offsetMs).toBe(500);
    expect(body.roots[0].startTime).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it("returns 404 for an unknown trace and 400 for a malformed id", async () => {
    const { handlers } = setup();
    expect((await handlers.getTrace(get(""), TRACE_ID)).status).toBe(404);
    expect((await handlers.getTrace(get(""), "not-hex")).status).toBe(400);
  });
});

describe("other endpoints", () => {
  it("serves overview, services and health", async () => {
    const { repo, handlers } = setup();
    repo.services = ["a", "b"];
    const overview = await (await handlers.overview(get("/metrics/overview"))).json();
    expect(overview.range.bucketSeconds).toBe(1440);
    expect(overview.timeseries).toHaveLength(60);
    expect(await (await handlers.services(get("/services"))).json()).toEqual({ items: ["a", "b"] });
    expect(await (await handlers.health()).json()).toEqual({ status: "ok" });
    expect((await handlers.ready()).status).toBe(200);
    repo.failWith = new RepositoryUnavailableError();
    expect((await handlers.ready()).status).toBe(503);
  });
});
