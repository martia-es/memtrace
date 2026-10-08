/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Evidencia por versión de un prompt (ADR-069): cruza trazas marcadas con el prompt, feedback y scores de evaluación.
 * Inserta datos sintéticos con un servicio único y los borra al terminar.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHousePromptEvidenceRepository } from "@/adapters/outbound/clickhouse/clickhouse-prompt-evidence-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { PromptEvidenceService } from "@/application/prompt-evidence-service";
import { toPricingCatalog } from "@/domain/pricing";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };

const SERVICE = `pe-${randomBytes(4).toString("hex")}`;
const OTHER_SERVICE = `${SERVICE}-other`;
const PROMPT = "weather-system";
const hex = (n: number) => randomBytes(n).toString("hex");
const T = { t1: hex(16), t2: hex(16), t3: hex(16), t4: hex(16), t5: hex(16), t6: hex(16), t7: hex(16), t8: hex(16) };
const RUN = `run-${SERVICE}`;

const T0 = Date.now() - 10 * 60_000;
const ts = (offsetMs: number) => new Date(T0 + offsetMs).toISOString().replace("T", " ").replace("Z", "000");
const CREATED = new Date(T0).toISOString().replace("T", " ").replace("Z", "");
const LATER = new Date(T0 + 60_000).toISOString().replace("T", " ").replace("Z", "");

interface Span {
  trace: string;
  id?: string;
  parent?: string;
  name: string;
  offsetMs: number;
  durationMs: number;
  status?: "OK" | "ERROR";
  message?: string;
  service?: string;
  attrs?: Record<string, string>;
}

const toRow = (s: Span) => ({
  Timestamp: ts(s.offsetMs),
  TraceId: s.trace,
  SpanId: s.id ?? hex(8),
  ParentSpanId: s.parent ?? "",
  SpanName: s.name,
  SpanKind: "SPAN_KIND_INTERNAL",
  ServiceName: s.service ?? SERVICE,
  SpanAttributes: s.attrs ?? {},
  ResourceAttributes: {},
  Duration: s.durationMs * 1e6,
  StatusCode: `STATUS_CODE_${s.status ?? "OK"}`,
  StatusMessage: s.status === "ERROR" ? (s.message ?? "boom") : "",
  "Events.Timestamp": [],
  "Events.Name": [],
  "Events.Attributes": [],
});

const stamp = (name: string, version: number) => ({ "memtrace.prompt.name": name, "memtrace.prompt.version": String(version) });
const llm = (input: number, output: number, extra: Record<string, string> = {}) => ({
  "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-4o", "gen_ai.usage.input_tokens": String(input), "gen_ai.usage.output_tokens": String(output), ...extra,
});
const tool = { "memtrace.step_type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "get_weather" };

describe.skipIf(!enabled)("ClickHousePromptEvidenceRepository (integration, ADR-069)", () => {
  let writer: ClickHouseClient;
  let service: PromptEvidenceService;
  const range = { from: new Date(T0 - 30 * 60_000), to: new Date(Date.now() + 60_000) };
  const pricing = toPricingCatalog([{ modelId: "gpt-4o", provider: "openai", inputPricePerToken: 0.000002, outputPricePerToken: 0.00001, source: "test", updatedAtMs: 0 }]);

  const insert = (table: string, values: unknown[]) =>
    writer.insert({ table: `${config.database}.${table}`, values, format: "JSONEachRow", clickhouse_settings: { date_time_input_format: "best_effort" } });

  beforeAll(async () => {
    writer = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    service = new PromptEvidenceService(new ClickHousePromptEvidenceRepository(createReadOnlyClient(config), config.database, config.maxConcurrentQueries), async () => pricing);

    const root1 = hex(8), root2 = hex(8), root3 = hex(8), root4 = hex(8), mid4 = hex(8), root7 = hex(8);
    const spans: Span[] = [
      // v1: dos trazas, una con una herramienta que falla por cuota (la raíz sigue OK)
      { trace: T.t1, id: root1, name: "turno", offsetMs: 0, durationMs: 1000, attrs: { "gen_ai.conversation.id": `${SERVICE}-c1` } },
      { trace: T.t1, parent: root1, name: "llm", offsetMs: 10, durationMs: 400, attrs: llm(1000, 100, stamp(PROMPT, 1)) },
      { trace: T.t2, id: root2, name: "turno", offsetMs: 100, durationMs: 2000, attrs: { "gen_ai.conversation.id": `${SERVICE}-c2` } },
      { trace: T.t2, parent: root2, name: "llm", offsetMs: 110, durationMs: 400, attrs: llm(500, 50, stamp(PROMPT, 1)) },
      { trace: T.t2, parent: root2, name: "get_weather", offsetMs: 600, durationMs: 100, status: "ERROR", message: "429 Too Many Requests", attrs: tool },
      // v2: una traza correcta y otra que falla en cascada (solo el span más profundo cuenta como causa)
      { trace: T.t3, id: root3, name: "turno", offsetMs: 200, durationMs: 500, attrs: { "gen_ai.conversation.id": `${SERVICE}-c3` } },
      { trace: T.t3, parent: root3, name: "llm", offsetMs: 210, durationMs: 300, attrs: llm(800, 80, stamp(PROMPT, 2)) },
      { trace: T.t4, id: root4, name: "turno", offsetMs: 300, durationMs: 900, status: "ERROR", message: "agent failed" },
      { trace: T.t4, id: mid4, parent: root4, name: "llm", offsetMs: 310, durationMs: 800, status: "ERROR", message: "request timed out after 30s", attrs: llm(300, 0, stamp(PROMPT, 2)) },
      { trace: T.t4, parent: mid4, name: "get_weather", offsetMs: 320, durationMs: 700, status: "ERROR", message: "request timed out after 30s", attrs: tool },
      // una traza que usó las dos versiones cuenta en las dos
      { trace: T.t7, id: root7, name: "turno", offsetMs: 400, durationMs: 700 },
      { trace: T.t7, parent: root7, name: "llm", offsetMs: 410, durationMs: 100, attrs: llm(100, 10, stamp(PROMPT, 1)) },
      { trace: T.t7, parent: root7, name: "llm", offsetMs: 520, durationMs: 100, attrs: llm(100, 10, stamp(PROMPT, 2)) },
      // ruido que no debe aparecer: sin prompt, otro prompt, otro servicio
      { trace: T.t5, name: "turno", offsetMs: 500, durationMs: 100, status: "ERROR", message: "401 Unauthorized" },
      { trace: T.t6, name: "llm", offsetMs: 600, durationMs: 100, attrs: llm(9999, 9999, stamp("other-prompt", 1)) },
      { trace: T.t8, name: "llm", offsetMs: 700, durationMs: 100, service: OTHER_SERVICE, attrs: llm(9999, 9999, stamp(PROMPT, 1)) },
    ];
    await insert("otel_traces", spans.map(toRow));

    await insert("user_feedback", [
      { ServiceName: SERVICE, TraceId: T.t1, SpanId: "", EndUserId: "a", Rating: 1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
      { ServiceName: SERVICE, TraceId: T.t2, SpanId: "", EndUserId: "a", Rating: -1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
      { ServiceName: SERVICE, TraceId: T.t3, SpanId: "", EndUserId: "a", Rating: 1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
      { ServiceName: SERVICE, TraceId: T.t4, SpanId: "", EndUserId: "a", Rating: 1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
      // un voto retirado (lápida posterior) no cuenta
      { ServiceName: SERVICE, TraceId: T.t3, SpanId: "", EndUserId: "b", Rating: -1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
      { ServiceName: SERVICE, TraceId: T.t3, SpanId: "", EndUserId: "b", Rating: -1, ExternalMessageId: "", CreatedAt: LATER, IsDeleted: 1 },
      // voto sobre una traza de otro prompt: no cuenta
      { ServiceName: SERVICE, TraceId: T.t6, SpanId: "", EndUserId: "a", Rating: -1, ExternalMessageId: "", CreatedAt: CREATED, IsDeleted: 0 },
    ]);

    const item = (index: number, traceId: string | null) => ({ ServiceName: SERVICE, DatasetRunId: RUN, ItemIndex: index, TraceId: traceId, Input: '"q"', Output: '"a"', ExpectedOutput: null, Error: null, CreatedAt: CREATED });
    const score = (index: number, name: string, dataType: string, value: string, valueNum: number | null) => ({
      ServiceName: SERVICE, DatasetRunId: RUN, ItemIndex: index, Name: name, Value: value, ValueNum: valueNum, DataType: dataType, Source: "code", Comment: null, JudgeModel: null, JudgePromptHash: null, CreatedAt: CREATED,
    });
    await insert("eval_items", [item(0, T.t1), item(1, T.t3), item(2, T.t6), item(3, null)]);
    await insert("eval_scores", [
      score(0, "accurate", "boolean", "true", 1), score(1, "accurate", "boolean", "false", 0), score(2, "accurate", "boolean", "true", 1), score(3, "accurate", "boolean", "true", 1),
      score(0, "tone", "numeric", "4", 4), score(1, "tone", "numeric", "5", 5),
      score(0, "topic", "categorical", "weather", null),
    ]);
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    for (const table of ["otel_traces", "user_feedback", "eval_items", "eval_scores"]) {
      await writer.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName IN ({a:String}, {b:String})`, query_params: { a: SERVICE, b: OTHER_SERVICE }, clickhouse_settings: settings });
    }
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: Object.values(T) }, clickhouse_settings: settings });
    await writer.close();
  });

  const evidence = async () => (await service.forPrompt(PROMPT, SERVICE, range)).versions;
  const version = async (n: number) => (await evidence()).find((v) => v.version === n)!;

  it("returns one entry per version used, newest first, and ignores other prompts, services and untagged traces", async () => {
    expect((await evidence()).map((v) => v.version)).toEqual([2, 1]);
  });

  it("counts the traces of each version; a trace that used both versions counts in both", async () => {
    expect((await version(1)).traces).toBe(3); // t1, t2, t7
    expect((await version(2)).traces).toBe(3); // t3, t4, t7
    expect((await version(1)).conversations).toBe(2);
  });

  it("counts a trace as failed when any of its spans failed, even if the root succeeded", async () => {
    const [v1, v2] = [await version(1), await version(2)];
    expect([v1.errorTraces, v2.errorTraces]).toEqual([1, 1]); // v1: t2 (tool, root ok); v2: t4
    expect(v1.errorRate).toBeCloseTo(1 / 3);
  });

  it("measures the latency of the root span of the version's traces", async () => {
    const v1 = await version(1); // roots: 1000, 2000, 700 ms
    expect(v1.latencyMs.p50).toBeCloseTo(1000, -1);
    expect(v1.latencyMs.p95).toBeGreaterThan(1500);
  });

  it("prices the tokens of the LLM calls of the version's traces", async () => {
    // tokens per TRACE: t7 used both versions, so both calls of t7 count in both (a trace is the unit of evidence)
    const v1 = await version(1); // t1 1000/100 + t2 500/50 + t7 200/20
    const v2 = await version(2); // t3 800/80 + t4 300/0 + t7 200/20
    expect([v1.inputTokens, v1.outputTokens]).toEqual([1700, 170]);
    expect([v2.inputTokens, v2.outputTokens]).toEqual([1300, 100]);
    expect(v1.costUsd!).toBeCloseTo(1700 * 0.000002 + 170 * 0.00001, 10);
    expect(v1.costComplete).toBe(true);
    expect(v1.costPerTraceUsd!).toBeCloseTo(v1.costUsd! / 3, 10);
  });

  it("explains the failures by business cause, using only the deepest failing span of a cascade", async () => {
    const v1 = await version(1);
    expect(v1.errorCauses.map((c) => c.id)).toEqual(["quota_exceeded"]);
    const v2 = await version(2);
    expect(v2.errorCauses.map((c) => c.id)).toEqual(["timeout"]);
    expect(v2.errorCauses[0]!.traces).toBe(1);
  });

  it("reports the end users' votes of the traces, ignoring retracted votes and other prompts' traces", async () => {
    expect((await version(1)).feedback).toMatchObject({ up: 1, down: 1, ratedTraces: 2, satisfaction: 50 }); // t1 up, t2 down
    expect((await version(2)).feedback).toMatchObject({ up: 2, down: 0, ratedTraces: 2, satisfaction: 100 }); // t3 up (b retracted), t4 up
  });

  it("aggregates the offline evaluation scores of the items whose trace used the version", async () => {
    const byName = (v: Awaited<ReturnType<typeof version>>) => Object.fromEntries(v.evaluators.map((e) => [e.name, e]));
    const v1 = byName(await version(1));
    const v2 = byName(await version(2));
    expect(v1.accurate).toMatchObject({ dataType: "boolean", items: 1, value: 1 }); // item 0 (t1); item 2 is another prompt's, item 3 has no trace
    expect(v2.accurate).toMatchObject({ items: 1, value: 0 }); // item 1 (t3)
    expect([v1.tone!.value, v2.tone!.value]).toEqual([4, 5]);
    expect(v1.topic).toMatchObject({ dataType: "categorical", items: 1, value: null });
    expect(v2.topic).toBeUndefined();
  });

  it("returns nothing for a prompt nobody used, or for another service", async () => {
    expect((await service.forPrompt("nobody-used-me", SERVICE, range)).versions).toEqual([]);
    expect((await service.forPrompt(PROMPT, `${SERVICE}-missing`, range)).versions).toEqual([]);
  });

  it("only sees the traffic of the requested range", async () => {
    const before = await service.forPrompt(PROMPT, SERVICE, { from: new Date(T0 - 3 * 3600_000), to: new Date(T0 - 2 * 3600_000) });
    expect(before.versions).toEqual([]);
  });
});
