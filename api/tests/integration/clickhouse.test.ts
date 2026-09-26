/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Inserta trazas sintéticas con un servicio único y las borra al terminar.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import { chooseBucketSeconds } from "@/domain/metrics";
import { buildTraceDetail } from "@/domain/tree";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);

const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const SERVICE = `it-${randomBytes(4).toString("hex")}`;
const TRACE_A = randomBytes(16).toString("hex");
const TRACE_B = randomBytes(16).toString("hex");
const hex8 = () => randomBytes(8).toString("hex");

const T0 = Date.now() - 10 * 60_000;
const ts = (offsetMs: number) => new Date(T0 + offsetMs).toISOString().replace("T", " ").replace("Z", "000"); // ns

interface Row {
  trace: string;
  spanId?: string;
  parent?: string;
  name: string;
  offsetMs: number;
  durationMs: number;
  status?: "OK" | "ERROR";
  attrs?: Record<string, string>;
  events?: { name: string; offsetMs: number; attrs: Record<string, string> }[];
}

const toRow = (r: Row) => ({
  Timestamp: ts(r.offsetMs),
  TraceId: r.trace,
  SpanId: r.spanId ?? hex8(),
  ParentSpanId: r.parent ?? "",
  SpanName: r.name,
  SpanKind: "SPAN_KIND_INTERNAL",
  ServiceName: SERVICE,
  SpanAttributes: r.attrs ?? {},
  Duration: r.durationMs * 1e6,
  StatusCode: `STATUS_CODE_${r.status ?? "OK"}`,
  StatusMessage: r.status === "ERROR" ? "boom" : "",
  "Events.Timestamp": (r.events ?? []).map((e) => ts(e.offsetMs)),
  "Events.Name": (r.events ?? []).map((e) => e.name),
  "Events.Attributes": (r.events ?? []).map((e) => e.attrs),
});

describe.skipIf(!enabled)("ClickHouseTraceRepository (integration)", () => {
  let writer: ClickHouseClient;
  let repo: ClickHouseTraceRepository;
  const rootA = hex8();
  const range = { fromMs: T0 - 30 * 60_000, toMs: Date.now() + 60_000 };

  const insert = (rows: Row[]) =>
    writer.insert({
      table: `${config.database}.otel_traces`,
      values: rows.map(toRow),
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });

  beforeAll(async () => {
    writer = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    repo = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries);

    await insert([
      { trace: TRACE_A, spanId: rootA, name: "agent-A", offsetMs: 0, durationMs: 2000, attrs: { "memtrace.step_type": "agent", "gen_ai.operation.name": "invoke_agent" } },
      {
        trace: TRACE_A, parent: rootA, name: "ChatOpenAI: gpt-4o", offsetMs: 100, durationMs: 500,
        attrs: { "memtrace.step_type": "llm", "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-4o", "gen_ai.provider.name": "openai", "gen_ai.usage.input_tokens": "10", "gen_ai.usage.output_tokens": "5", "gen_ai.usage.total_tokens": "15", "gen_ai.response.finish_reasons": '["stop"]' },
      },
      {
        trace: TRACE_A, parent: rootA, name: "buscar", offsetMs: 700, durationMs: 200, status: "ERROR",
        attrs: { "memtrace.step_type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "buscar" },
        events: [{ name: "exception", offsetMs: 800, attrs: { "exception.message": "boom" } }],
      },
    ]);
    // segundo lote de la MISMA traza: la vista materializada añade otra fila de índice
    await insert([
      { trace: TRACE_A, parent: rootA, name: "tardia", offsetMs: 1500, durationMs: 100, attrs: { "memtrace.step_type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "tardia" } },
    ]);
    await insert([{ trace: TRACE_B, name: "agent-B", offsetMs: 10_000, durationMs: 1000, status: "ERROR", attrs: { "memtrace.step_type": "agent" } }]);
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: [TRACE_A, TRACE_B] }, clickhouse_settings: settings });
    await writer.close();
  });

  it("the read-only client cannot write", async () => {
    const ro = createReadOnlyClient(config);
    await expect(
      ro.insert({ table: `${config.database}.otel_traces`, values: [toRow({ trace: TRACE_B, name: "x", offsetMs: 0, durationMs: 1 })], format: "JSONEachRow" }),
    ).rejects.toThrow();
    await ro.close();
  });

  it("lists the service and pings", async () => {
    await expect(repo.ping()).resolves.toBeUndefined();
    expect(await repo.listServices(range)).toContain(SERVICE);
  });

  it("lists root spans newest first with aggregates", async () => {
    const page = await repo.listTraces({ ...range, service: SERVICE, limit: 10 });
    expect(page.items.map((t) => t.traceId)).toEqual([TRACE_B, TRACE_A]);
    expect(page.nextCursor).toBeNull();
    const a = page.items[1]!;
    expect(a).toMatchObject({ rootSpanName: "agent-A", status: "ok", spanCount: 4, errorCount: 1, totalTokens: 15, durationMs: 2000 });
    expect(page.items[0]).toMatchObject({ status: "error", spanCount: 1, errorCount: 1 });
  });

  it("paginates with a stable keyset cursor", async () => {
    const first = await repo.listTraces({ ...range, service: SERVICE, limit: 1 });
    expect(first.items.map((t) => t.traceId)).toEqual([TRACE_B]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.listTraces({ ...range, service: SERVICE, limit: 1, cursor: first.nextCursor! });
    expect(second.items.map((t) => t.traceId)).toEqual([TRACE_A]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by root status, hasErrors and minimum duration", async () => {
    const ids = async (extra: object) =>
      (await repo.listTraces({ ...range, service: SERVICE, limit: 10, ...extra })).items.map((t) => t.traceId);
    expect(await ids({ status: "ok" })).toEqual([TRACE_A]);
    expect(await ids({ status: "error" })).toEqual([TRACE_B]);
    expect(await ids({ hasErrors: true })).toEqual([TRACE_B, TRACE_A]); // A por su tool fallida
    expect(await ids({ minDurationMs: 1500 })).toEqual([TRACE_A]);
  });

  it("rebuilds a trace whose spans arrived in two batches", async () => {
    const found = await repo.getTraceSpans(TRACE_A, 100);
    expect(found?.truncated).toBe(false);
    const detail = buildTraceDetail(TRACE_A, found!.spans, false);
    expect(detail.spanCount).toBe(4);
    expect(detail.roots).toHaveLength(1);
    expect(detail.roots[0]!.children.map((c) => c.name)).toEqual(["ChatOpenAI: gpt-4o", "buscar", "tardia"]);
    expect(detail.roots[0]!.children.every((c) => !c.orphan)).toBe(true);
    const tool = detail.roots[0]!.children[1]!;
    expect(tool.status).toEqual({ code: "error", message: "boom" });
    expect(tool.events[0]).toMatchObject({ name: "exception", attributes: { "exception.message": "boom" } });
    expect(detail.roots[0]!.children[0]!.genAi).toMatchObject({ requestModel: "gpt-4o", totalTokens: 15, finishReasons: ["stop"] });
  });

  it("truncates beyond maxSpans and returns null for unknown traces", async () => {
    expect((await repo.getTraceSpans(TRACE_A, 2))).toMatchObject({ truncated: true });
    expect((await repo.getTraceSpans(TRACE_A, 2))!.spans).toHaveLength(2);
    expect(await repo.getTraceSpans("0".repeat(32), 10)).toBeNull();
  });

  it("computes the overview", async () => {
    const bucketSeconds = chooseBucketSeconds(range.fromMs, range.toMs);
    const o = await repo.getOverview({ ...range, service: SERVICE, bucketSeconds });
    expect(o.totals).toMatchObject({ traces: 2, spans: 5, errorTraces: 1, errorRate: 0.5, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(o.latencyMs.p50).toBeGreaterThan(0);
    expect(o.byModel).toEqual([expect.objectContaining({ model: "gpt-4o", calls: 1, inputTokens: 10, outputTokens: 5 })]);
    expect(o.byTool.map((t) => [t.tool, t.calls, t.errors]).sort()).toEqual([["buscar", 1, 1], ["tardia", 1, 0]]);
    expect(o.timeseries.reduce((n, p) => n + p.traces, 0)).toBe(2);
    expect(o.timeseries.reduce((n, p) => n + p.totalTokens, 0)).toBe(15);
  });

  it("reports an unreachable store as RepositoryUnavailableError", async () => {
    const dead = new ClickHouseTraceRepository(createReadOnlyClient({ ...config, url: "http://127.0.0.1:1" }), config.database);
    await expect(dead.ping()).rejects.toBeInstanceOf(RepositoryUnavailableError);
    await expect(dead.listServices(range)).rejects.toBeInstanceOf(RepositoryUnavailableError);
  });
});
