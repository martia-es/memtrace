/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Inserta trazas sintéticas con un servicio único y las borra al terminar.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { toAttributeKeysResponse } from "@/adapters/inbound/http/mappers";
import { RepositoryUnavailableError } from "@/application/errors";
import { chooseBucketSeconds } from "@/domain/metrics";
import { buildTraceDetail } from "@/domain/tree";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);

const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const SERVICE = `it-${randomBytes(4).toString("hex")}`;
const TRACE_A = randomBytes(16).toString("hex");
const TRACE_B = randomBytes(16).toString("hex");
// Conversaciones (ADR-012) en un servicio aparte para no alterar las cifras de los tests anteriores
const CONV_SERVICE = `${SERVICE}-conv`;
const CONV1 = `${SERVICE}-c1`;
const CONV2 = `${SERVICE}-c2`;
const CONV3 = `${SERVICE}-c3`;
const T1 = randomBytes(16).toString("hex");
const T2 = randomBytes(16).toString("hex");
const T3 = randomBytes(16).toString("hex");
const T4 = randomBytes(16).toString("hex"); // sin conversación
const T5_OLD = randomBytes(16).toString("hex"); // CONV3, hace 3 días: fuera del rango pero dentro de la retención
const T6 = randomBytes(16).toString("hex");
const ERR_SERVICE = `${SERVICE}-err`;
const REV_SERVICE = `${SERVICE}-rev`;
const ATTR_SERVICE = `${SERVICE}-attrs`;
const REV_A = "a".repeat(40);
const REV_B = "b".repeat(40);
const DAY = 24 * 3600_000;
const hex8 = () => randomBytes(8).toString("hex");

const T0 = Date.now() - 10 * 60_000;
const ts = (offsetMs: number) => new Date(T0 + offsetMs).toISOString().replace("T", " ").replace("Z", "000"); // ns

interface Row {
  trace: string;
  service?: string;
  spanId?: string;
  parent?: string;
  name: string;
  offsetMs: number;
  durationMs: number;
  status?: "OK" | "ERROR";
  message?: string;
  attrs?: Record<string, string>;
  /** atributos de recurso OTel; `vcs.repository.ref.revision` alimenta la columna Revision (ADR-065) */
  resource?: Record<string, string>;
  events?: { name: string; offsetMs: number; attrs: Record<string, string> }[];
}

const toRow = (r: Row) => ({
  Timestamp: ts(r.offsetMs),
  TraceId: r.trace,
  SpanId: r.spanId ?? hex8(),
  ParentSpanId: r.parent ?? "",
  SpanName: r.name,
  SpanKind: "SPAN_KIND_INTERNAL",
  ServiceName: r.service ?? SERVICE,
  SpanAttributes: r.attrs ?? {},
  ResourceAttributes: r.resource ?? {},
  Duration: r.durationMs * 1e6,
  StatusCode: `STATUS_CODE_${r.status ?? "OK"}`,
  StatusMessage: r.status === "ERROR" ? (r.message ?? "boom") : "",
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
    const conv = (id: string, extra: Record<string, string> = {}) => ({ "gen_ai.conversation.id": id, ...extra });
    const chat = (id: string, tin: number, tout: number) =>
      conv(id, { "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": String(tin), "gen_ai.usage.output_tokens": String(tout), "gen_ai.usage.total_tokens": String(tin + tout) });
    const r1 = hex8();
    const r2 = hex8();
    await insert([
      // CONV1: dos turnos; el primero tiene un LLM y una herramienta fallida
      { trace: T1, service: CONV_SERVICE, spanId: r1, name: "turno-1", offsetMs: 0, durationMs: 1000, attrs: conv(CONV1) },
      { trace: T1, service: CONV_SERVICE, parent: r1, name: "llm", offsetMs: 50, durationMs: 300, attrs: { ...chat(CONV1, 10, 5), "gen_ai.request.model": "gpt-4o", "gen_ai.input.messages": JSON.stringify([{ role: "user", content: "¿dónde está mi pedido?" }]), "gen_ai.output.messages": JSON.stringify([{ role: "assistant", content: "en camino" }]) } },
      { trace: T1, service: CONV_SERVICE, parent: r1, name: "tool", offsetMs: 400, durationMs: 100, status: "ERROR", attrs: conv(CONV1) },
      { trace: T2, service: CONV_SERVICE, spanId: r2, name: "turno-2", offsetMs: 60_000, durationMs: 500, attrs: conv(CONV1) },
      { trace: T2, service: CONV_SERVICE, parent: r2, name: "llm", offsetMs: 60_050, durationMs: 200, attrs: { ...chat(CONV1, 20, 10), "gen_ai.input.messages": JSON.stringify([{ role: "user", content: "¿y mañana?" }]), "gen_ai.output.messages": JSON.stringify([{ role: "assistant", content: "sí, mañana" }]) } },
      // CONV2: un turno cuyo raíz falla
      { trace: T3, service: CONV_SERVICE, name: "turno-3", offsetMs: 120_000, durationMs: 200, status: "ERROR", attrs: conv(CONV2) },
      // sin conversación
      { trace: T4, service: CONV_SERVICE, name: "suelta", offsetMs: 130_000, durationMs: 50 },
      // CONV3: un turno de hace 3 días y otro reciente
      { trace: T5_OLD, service: CONV_SERVICE, name: "turno-viejo", offsetMs: -3 * DAY, durationMs: 400, attrs: conv(CONV3) },
      { trace: T6, service: CONV_SERVICE, name: "turno-nuevo", offsetMs: 180_000, durationMs: 100, attrs: conv(CONV3) },
    ]);
    await insert([{ trace: TRACE_B, name: "agent-B", offsetMs: 10_000, durationMs: 1000, status: "ERROR", attrs: { "memtrace.step_type": "agent" } }]);
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: CONV_SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: ERR_SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: REV_SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName = {s:String}`, query_params: { s: ATTR_SERVICE }, clickhouse_settings: settings });
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: [TRACE_A, TRACE_B, T1, T2, T3, T4, T5_OLD, T6] }, clickhouse_settings: settings });
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

  describe("conversations (ADR-012)", () => {
    const list = (extra: object = {}) => repo.listConversations({ ...range, service: CONV_SERVICE, limit: 10, ...extra });

    it("lists conversations by last activity with figures over their whole history", async () => {
      const page = await list();
      expect(page.items.map((c) => c.conversationId)).toEqual([CONV3, CONV2, CONV1]); // T6 (+180 s) > T3 (+120 s) > T2 (+60 s)
      const [c3, c2, c1] = page.items;
      expect(c1).toMatchObject({ turnCount: 2, errorTurns: 0, failedSpans: 1, totalTokens: 45, serviceNames: [CONV_SERVICE] });
      expect(c1!.activeMs).toBeCloseTo(1500, 0);
      expect(c2).toMatchObject({ turnCount: 1, errorTurns: 1, failedSpans: 1, totalTokens: 0 });
      // CONV3 cuenta su turno de hace 3 días aunque el rango solo cubre los últimos 40 min
      expect(c3!.turnCount).toBe(2);
      expect(c3!.startTimeUs / 1000).toBeLessThan(range.fromMs);
      expect(page.nextCursor).toBeNull();
    });

    it("never lists traces without a conversation as conversations", async () => {
      const ids = (await list()).items.map((c) => c.conversationId);
      expect(ids).toHaveLength(3);
    });

    it("paginates with a keyset cursor", async () => {
      const first = await list({ limit: 2 });
      expect(first.items.map((c) => c.conversationId)).toEqual([CONV3, CONV2]);
      expect(first.nextCursor).not.toBeNull();
      const second = await list({ limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((c) => c.conversationId)).toEqual([CONV1]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters by hasErrors and by service", async () => {
      expect((await list({ hasErrors: true })).items.map((c) => c.conversationId).sort()).toEqual([CONV1, CONV2].sort());
      expect((await repo.listConversations({ ...range, service: "no-such-service", limit: 10 })).items).toEqual([]);
    });

    it("returns one conversation over the retention window, or null", async () => {
      const found = await repo.getConversation(CONV3, { fromMs: Date.now() - 30 * DAY, toMs: Date.now() });
      expect(found).toMatchObject({ conversationId: CONV3, turnCount: 2 });
      expect(await repo.getConversation("no-such-conversation", { fromMs: Date.now() - 30 * DAY, toMs: Date.now() })).toBeNull();
    });

    it("lists a conversation's turns chronologically, paginated, with their conversation id", async () => {
      const q = { fromMs: Date.now() - 30 * DAY, toMs: Date.now(), conversationId: CONV3, order: "asc" as const, limit: 1 };
      const first = await repo.listTraces(q);
      expect(first.items.map((t) => [t.traceId, t.conversationId])).toEqual([[T5_OLD, CONV3]]);
      const second = await repo.listTraces({ ...q, cursor: first.nextCursor! });
      expect(second.items.map((t) => t.traceId)).toEqual([T6]);
      expect(second.nextCursor).toBeNull();
    });

    it("exposes the conversation in the trace list, null when absent", async () => {
      const page = await repo.listTraces({ ...range, service: CONV_SERVICE, limit: 20 });
      const byTrace = Object.fromEntries(page.items.map((t) => [t.traceId, t.conversationId]));
      expect(byTrace[T4]).toBeNull();
      expect(byTrace[T1]).toBe(CONV1);
    });

    it("counts distinct conversations in the overview", async () => {
      const o = await repo.getOverview({ ...range, service: CONV_SERVICE, bucketSeconds: chooseBucketSeconds(range.fromMs, range.toMs) });
      expect(o.totals.conversations).toBe(3);
    });
    it("returns the captured messages of a conversation's LLM spans in order", async () => {
      const range30 = { fromMs: Date.now() - 30 * DAY, toMs: Date.now() };
      const { records, truncated } = await repo.getConversationMessages(CONV1, range30, 10);
      expect(truncated).toBe(false);
      expect(records.map((r) => [r.traceId, r.model])).toEqual([[T1, "gpt-4o"], [T2, null]]);
      expect(JSON.parse(records[0]!.inputMessages!)[0].content).toBe("¿dónde está mi pedido?");
      expect(records[1]!.outputMessages).toContain("sí, mañana");
      expect((await repo.getConversationMessages(CONV1, range30, 1)).truncated).toBe(true);
      expect((await repo.getConversationMessages(CONV2, range30, 10)).records).toEqual([]); // sin spans de LLM
    });

    it("lists spans newest first, deducing the kind and reading captured content", async () => {
      const q = { ...range, service: CONV_SERVICE, conversationId: CONV1, limit: 10 };
      const { items, nextCursor } = await repo.listSpans(q);
      expect(nextCursor).toBeNull();
      expect(items.map((s) => s.name)).toEqual(["llm", "turno-2", "tool", "llm", "turno-1"]);
      const llm = items[3]!;
      expect(llm).toMatchObject({ kind: "llm", chat: true, model: "gpt-4o", totalTokens: 15, conversationId: CONV1, status: "ok", parentSpanId: expect.any(String) });
      expect(JSON.parse(llm.inputRaw!)[0].content).toBe("¿dónde está mi pedido?");
      expect(items[2]).toMatchObject({ kind: "unknown", chat: false, totalTokens: null, status: "error", inputRaw: null });
      expect(items[4]!.parentSpanId).toBeNull();
    });

    it("filters spans by kind, model, status and text, and paginates with a keyset cursor", async () => {
      const q = { ...range, service: CONV_SERVICE, limit: 20 };
      const names = async (extra: object) => (await repo.listSpans({ ...q, ...extra })).items.map((s) => s.name);
      expect(await names({ kind: "llm", conversationId: CONV1 })).toEqual(["llm", "llm"]);
      expect(await names({ model: "gpt-4o" })).toEqual(["llm"]);
      expect(await names({ status: "error", conversationId: CONV1 })).toEqual(["tool"]);
      expect(await names({ text: "MAÑANA" })).toEqual(["llm"]);
      expect(await names({ text: "no-existe-xyz" })).toEqual([]);

      const first = await repo.listSpans({ ...q, conversationId: CONV1, limit: 2 });
      expect(first.items).toHaveLength(2);
      const second = await repo.listSpans({ ...q, conversationId: CONV1, limit: 10, cursor: first.nextCursor! });
      expect(second.items.map((s) => s.name)).toEqual(["tool", "llm", "turno-1"]);
    });
  });
  describe("code revision (ADR-065)", () => {
    const TA = randomBytes(16).toString("hex");
    const TB = randomBytes(16).toString("hex");
    const TNONE = randomBytes(16).toString("hex");
    const CONV = `${SERVICE}-rev-conv`;

    beforeAll(async () => {
      const rev = (sha: string) => ({ "vcs.repository.ref.revision": sha });
      await insert([
        { trace: TA, service: REV_SERVICE, name: "turno", offsetMs: 0, durationMs: 100, resource: rev(REV_A), attrs: { "gen_ai.conversation.id": CONV } },
        { trace: TB, service: REV_SERVICE, name: "turno", offsetMs: 200, durationMs: 100, resource: rev(REV_B) },
        { trace: TNONE, service: REV_SERVICE, name: "turno", offsetMs: 400, durationMs: 100 },
      ]);
    });

    const traces = async (revision?: string) => (await repo.listTraces({ ...range, service: REV_SERVICE, revision, limit: 20 })).items;

    it("materializes the column from the resource attribute and returns it on each trace", async () => {
      const byId = new Map((await traces()).map((t) => [t.traceId, t.revision]));
      expect(byId.get(TA)).toBe(REV_A);
      expect(byId.get(TB)).toBe(REV_B);
      expect(byId.get(TNONE)).toBeNull(); // sin commit: versión desconocida
    });

    it("filters by the full SHA or by a prefix, case-insensitively", async () => {
      expect((await traces(REV_A)).map((t) => t.traceId)).toEqual([TA]);
      expect((await traces("bbbbbbb")).map((t) => t.traceId)).toEqual([TB]);
      expect((await traces("BBBBBBB")).map((t) => t.traceId)).toEqual([TB]);
      expect(await traces("ccccccc")).toEqual([]);
    });

    it("lists the versions seen, most recent first, with their trace counts", async () => {
      const found = await repo.listRevisions({ ...range, service: REV_SERVICE });
      expect(found.map((r) => [r.revision, r.traces])).toEqual([[REV_B, 1], [REV_A, 1]]); // TNONE no cuenta: sin versión
      expect(found[0]!.lastSeenMs).toBeGreaterThan(found[1]!.lastSeenMs);
    });

    it("filters conversations and spans, and puts the revision on the trace detail", async () => {
      expect((await repo.listConversations({ ...range, service: REV_SERVICE, revision: "aaaaaaa", limit: 10 })).items.map((c) => c.conversationId)).toEqual([CONV]);
      expect((await repo.listConversations({ ...range, service: REV_SERVICE, revision: "bbbbbbb", limit: 10 })).items).toEqual([]);
      expect((await repo.listSpans({ ...range, service: REV_SERVICE, revision: REV_B, limit: 10 })).items.map((s) => s.traceId)).toEqual([TB]);
      const found = await repo.getTraceSpans(TA, 100);
      expect(buildTraceDetail(TA, found!.spans, false).revision).toBe(REV_A);
    });
  });
  describe("prompt version (ADR-068)", () => {
    const PROMPT_SERVICE = `${SERVICE}-prompt`;
    const P1 = randomBytes(16).toString("hex");
    const P2 = randomBytes(16).toString("hex");
    const PNONE = randomBytes(16).toString("hex");
    const prompt = (name: string, version: string) => ({ "memtrace.prompt.name": name, "memtrace.prompt.version": version });

    beforeAll(async () => {
      const root1 = hex8();
      const root2 = hex8();
      await insert([
        // el prompt lo marca el span del modelo, no la raíz de la traza
        { trace: P1, service: PROMPT_SERVICE, spanId: root1, name: "turno", offsetMs: 0, durationMs: 300 },
        { trace: P1, service: PROMPT_SERVICE, parent: root1, name: "llm", offsetMs: 10, durationMs: 200, attrs: prompt("weather-system", "1") },
        { trace: P2, service: PROMPT_SERVICE, spanId: root2, name: "turno", offsetMs: 400, durationMs: 300 },
        { trace: P2, service: PROMPT_SERVICE, parent: root2, name: "llm", offsetMs: 410, durationMs: 200, attrs: prompt("weather-system", "2") },
        { trace: PNONE, service: PROMPT_SERVICE, name: "turno", offsetMs: 800, durationMs: 100, attrs: prompt("geo-tools", "7") },
      ]);
    });

    const traces = async (promptName?: string, promptVersion?: number) => (await repo.listTraces({ ...range, service: PROMPT_SERVICE, promptName, promptVersion, limit: 20 })).items.map((t) => t.traceId).sort();
    const spans = async (promptName?: string, promptVersion?: number) => (await repo.listSpans({ ...range, service: PROMPT_SERVICE, promptName, promptVersion, limit: 20 })).items;

    it("keeps the traces that used the prompt, even when only a child span marks it", async () => {
      expect(await traces("weather-system")).toEqual([P1, P2].sort());
      expect(await traces("geo-tools")).toEqual([PNONE]);
      expect(await traces("does-not-exist")).toEqual([]);
    });

    it("narrows to one version", async () => {
      expect(await traces("weather-system", 1)).toEqual([P1]);
      expect(await traces("weather-system", 2)).toEqual([P2]);
      expect(await traces("weather-system", 3)).toEqual([]);
    });

    it("filters spans by prompt and version, and leaves spans without a prompt out", async () => {
      expect((await spans("weather-system")).map((s) => s.name)).toEqual(["llm", "llm"]);
      expect((await spans("weather-system", 2)).map((s) => s.traceId)).toEqual([P2]);
      expect((await spans()).length).toBe(5);
    });
  });
  it("groups only the deepest failing spans and reports totals (ADR-066)", async () => {
    const trace = randomBytes(16).toString("hex");
    const okTrace = randomBytes(16).toString("hex");
    const root = hex8();
    const mid = hex8();
    const tool = { "memtrace.step_type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "get_weather", "gen_ai.conversation.id": `${ERR_SERVICE}-c` };
    await insert([
      { trace, service: ERR_SERVICE, spanId: root, name: "agent", offsetMs: 0, durationMs: 900, status: "ERROR", message: "429 Too Many Requests", attrs: { "gen_ai.conversation.id": `${ERR_SERVICE}-c` } },
      { trace, service: ERR_SERVICE, spanId: mid, parent: root, name: "node", offsetMs: 10, durationMs: 800, status: "ERROR", message: "429 Too Many Requests" },
      {
        trace, service: ERR_SERVICE, parent: mid, name: "get_weather", offsetMs: 20, durationMs: 700, status: "ERROR", message: "429 Too Many Requests", attrs: tool,
        events: [{ name: "exception", offsetMs: 30, attrs: { "exception.type": "httpx.HTTPStatusError", "exception.message": "upstream said slow down" } }],
      },
      { trace: okTrace, service: ERR_SERVICE, name: "agent", offsetMs: 2000, durationMs: 100, attrs: { "gen_ai.conversation.id": `${ERR_SERVICE}-ok` } },
    ]);
    const result = await repo.listErrorGroups({ ...range, service: ERR_SERVICE });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ kind: "tool", name: "get_weather", message: "429 Too Many Requests", exceptionType: "httpx.HTTPStatusError", exceptionMessage: "upstream said slow down", occurrences: 1, traces: 1 });
    expect(result).toMatchObject({ tracesWithErrors: 1, totalTraces: 2 });
  });

  describe("attribute classification (ADR-077)", () => {
    const N = 40;
    const cities = ["Madrid", "Lisboa", "Paris", "Roma", "Berlin", "Viena", "Praga", "Oslo"];
    const uuid = (i: number) => `3f2b8c1e-9d4a-4c7e-8a55-${String(i).padStart(12, "0")}`;

    beforeAll(async () => {
      const tools = Array.from({ length: N }, (_, i): Row => ({
        trace: randomBytes(16).toString("hex"),
        service: ATTR_SERVICE,
        name: "tool",
        offsetMs: i * 10,
        durationMs: 5,
        attrs: {
          "memtrace.step_type": "tool",
          "gen_ai.tool.name": ["get_weather", "get_uv", "search"][i % 3]!,
          city: i % 10 === 0 ? "" : cities[i % cities.length]!,
          customer_id: String(100_000 + i),
          trace_ref: uuid(i),
          order_total: String(10 + i * 1.37),
          rating: String((i % 5) + 1),
          flag: i % 2 === 0 ? "nan" : "inf",
          message: "texto largo que parece un mensaje de usuario escrito por una persona ".repeat(2),
        },
      }));
      // un paso de otro tipo y un servicio ajeno no deben contar
      await insert([...tools, { trace: randomBytes(16).toString("hex"), service: ATTR_SERVICE, name: "llm", offsetMs: 0, durationMs: 5, attrs: { "memtrace.step_type": "llm", only_in_llm: "x" } }]);
    });

    it("measures each key of the chosen steps: spans, values, distinct values, numbers, length and id-like values", async () => {
      const keys = await repo.getAttributeKeys({ ...range, service: ATTR_SERVICE, stepTypes: ["tool"] });
      const by = new Map(keys.map((k) => [k.key, k]));
      expect(by.has("only_in_llm")).toBe(false);
      expect(by.get("city")).toMatchObject({ count: N, nonEmpty: N - 4, distinct: 8 });
      expect(by.get("customer_id")).toMatchObject({ numericCount: N, distinct: N });
      expect(by.get("trace_ref")).toMatchObject({ idLikeCount: N });
      expect(by.get("flag")!.numericCount).toBe(0); // "nan" e "inf" no son números
      expect(by.get("message")!.avgLength).toBeGreaterThan(60);
    });

    it("classifies them: categories and measures stay visible, ids, free text and plumbing are hidden", async () => {
      const keys = await repo.getAttributeKeys({ ...range, service: ATTR_SERVICE, stepTypes: ["tool"] });
      const kinds = Object.fromEntries(toAttributeKeysResponse(keys).items.map((k) => [k.key, `${k.kind}${k.hiddenByDefault ? "/hidden" : ""}`]));
      expect(kinds).toMatchObject({
        city: "category",
        "gen_ai.tool.name": "category",
        rating: "category",
        flag: "category",
        order_total: "number",
        customer_id: "id/hidden",
        trace_ref: "id/hidden",
        message: "text/hidden",
        "memtrace.step_type": "technical/hidden",
      });
    });
  });
});
