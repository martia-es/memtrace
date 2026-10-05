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
      items: [{ traceId: TRACE_ID, rootSpanName: "agent", serviceName: "svc", startTimeUs: 1_790_000_000_123_456, durationMs: 12.5, status: "ok", spanCount: 3, errorCount: 0, totalTokens: 7, input: null, output: null, error: null, conversationId: "conv-1" }],
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


describe("conversations endpoints", () => {
  const summary = (id: string) => ({
    conversationId: id, serviceNames: ["svc"], startTimeUs: 1_790_000_000_000_000, lastActivityUs: 1_790_000_060_000_000,
    turnCount: 2, errorTurns: 1, failedSpans: 2, totalTokens: 30, activeMs: 1500.5,
  });

  it("lists conversations with ISO dates and a cursor that round-trips", async () => {
    const { repo, handlers } = setup();
    const cursor = { lastActivityUs: 1_790_000_060_000_000, conversationId: "conv a/b" };
    repo.conversationPage = { items: [summary("conv a/b")], nextCursor: cursor };
    const response = await handlers.listConversations(get("/conversations?service=svc&hasErrors=true"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({ conversationId: "conv a/b", turnCount: 2, errorTurns: 1, lastActivity: new Date(1_790_000_060_000).toISOString() });

    await handlers.listConversations(get(`/conversations?cursor=${body.nextCursor}&limit=5`));
    expect(repo.lastConversationQuery).toMatchObject({ cursor, limit: 5 });
  });

  it("rejects an invalid cursor or limit", async () => {
    const { handlers } = setup();
    expect((await handlers.listConversations(get("/conversations?cursor=%%%"))).status).toBe(400);
    expect((await handlers.listConversations(get("/conversations?limit=999"))).status).toBe(400);
  });

  it("returns a conversation with its turns, and 404 when unknown", async () => {
    const { repo, handlers } = setup();
    repo.conversations.set("c1", summary("c1"));
    repo.page = { items: [{ traceId: TRACE_ID, rootSpanName: "turno", serviceName: "svc", startTimeUs: 1_790_000_000_000_000, durationMs: 5, status: "ok", spanCount: 2, errorCount: 0, totalTokens: 0, input: null, output: null, error: null, conversationId: "c1" }], nextCursor: null };
    const ok = await handlers.getConversation(get("/conversations/c1"), "c1");
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body).toMatchObject({ conversationId: "c1", turnCount: 2 });
    expect(body.turns.items[0]).toMatchObject({ conversationId: "c1", rootSpanName: "turno" });
    expect((await handlers.getConversation(get("/conversations/x"), "x")).status).toBe(404);
  });

  it("returns the span tree of each turn, and 404 when unknown", async () => {
    const { repo, handlers } = setup();
    repo.conversations.set("c1", summary("c1"));
    repo.page = { items: [{ traceId: TRACE_ID, rootSpanName: "turno", serviceName: "svc", startTimeUs: 1_790_000_000_000_000, durationMs: 5, status: "ok", spanCount: 1, errorCount: 0, totalTokens: 0, input: null, output: null, error: null, conversationId: "c1" }], nextCursor: null };
    repo.traces.set(TRACE_ID, { spans: [span({ spanId: TRACE_ID })], truncated: false });
    const ok = await handlers.getConversationTree(get("/conversations/c1/tree"), "c1");
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ traceId: TRACE_ID });
    expect(body.items[0].roots).toHaveLength(1);
    expect((await handlers.getConversationTree(get("/conversations/x/tree"), "x")).status).toBe(404);
  });

  it("passes the conversationId filter to the trace list", async () => {
    const { repo, handlers } = setup();
    await handlers.listTraces(get("/traces?conversationId=c1"));
    expect(repo.lastListQuery).toMatchObject({ conversationId: "c1" });
  });

  it("serves the transcript and 404s for an unknown conversation", async () => {
    const { repo, handlers } = setup();
    repo.conversations.set("c1", summary("c1"));
    repo.chatRecords = [{
      traceId: TRACE_ID, startTimeUs: 1_790_000_000_000_000, model: "gpt-4o",
      inputMessages: JSON.stringify([{ role: "user", content: "hola" }]), outputMessages: JSON.stringify([{ role: "assistant", content: "buenas" }]),
    }];
    const ok = await handlers.getTranscript(get("/conversations/c1/transcript"), "c1");
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body).toMatchObject({ conversationId: "c1", contentCaptured: true, truncated: false });
    expect(body.turns[0]).toEqual({ traceId: TRACE_ID, model: "gpt-4o", user: "hola", assistant: "buenas", startTime: new Date(1_790_000_000_000).toISOString() });
    expect((await handlers.getTranscript(get("/x"), "x")).status).toBe(404);
  });

  it("says content was not captured instead of returning an empty error", async () => {
    const { repo, handlers } = setup();
    repo.conversations.set("c1", summary("c1"));
    repo.chatRecords = [{ traceId: TRACE_ID, startTimeUs: 1, model: null, inputMessages: null, outputMessages: null }];
    const body = await (await handlers.getTranscript(get("/x"), "c1")).json();
    expect(body).toMatchObject({ contentCaptured: false, turns: [] });
  });
});

describe("GET /spans", () => {
  it("returns previews with ISO dates, forwards filters and round-trips the cursor", async () => {
    const { repo, handlers } = setup();
    const cursor = { startTimeUs: 1_790_000_000_000_000, spanId: "00f067aa0ba902b7" };
    repo.spanPage = {
      items: [{ spanId: "00f067aa0ba902b7", traceId: TRACE_ID, parentSpanId: null, conversationId: "c1", name: "tool.search", kind: "tool", serviceName: "svc", startTimeUs: 1_790_000_000_000_000, durationMs: 9, status: "error", model: null, totalTokens: null, inputTokens: null, outputTokens: null, inputRaw: '{"a":1}', outputRaw: "TimeoutError", chat: false }],
      nextCursor: cursor,
    };
    const response = await handlers.listSpans(get("/spans?kind=tool&status=error&text=vuelo&service=svc&conversationId=c1&limit=20"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({ name: "tool.search", kind: "tool", input: '{"a":1}', output: "TimeoutError", startTime: new Date(1_790_000_000_000).toISOString() });
    expect(repo.lastSpanQuery).toMatchObject({ kind: "tool", status: "error", text: "vuelo", service: "svc", conversationId: "c1", limit: 20 });

    await handlers.listSpans(get(`/spans?cursor=${body.nextCursor}`));
    expect(repo.lastSpanQuery?.cursor).toEqual(cursor);
  });

  it.each(["kind=weird", "status=maybe", "limit=999", "cursor=%%%", "text="])("rejects %s", async (qs) => {
    const { handlers } = setup();
    expect((await handlers.listSpans(get(`/spans?${qs}`))).status).toBe(400);
  });

  it("answers 503 when the store is unavailable", async () => {
    const { repo, handlers } = setup();
    repo.failWith = new RepositoryUnavailableError(new Error("down"));
    expect((await handlers.listSpans(get("/spans"))).status).toBe(503);
  });
});
