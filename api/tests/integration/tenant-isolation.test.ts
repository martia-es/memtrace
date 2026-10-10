/**
 * Aislamiento entre tenants contra el ClickHouse real (ADR-077). Opt-in: `npm run test:integration`.
 *
 * Dos experimentos de dos organizaciones distintas usan el MISMO `service.name` (y hasta el mismo TraceId y
 * ConversationId, que los elige el cliente). Ninguna lectura de un tenant puede devolver datos del otro, y las filas
 * anteriores a la migración 013 (ExperimentId vacío) no las ve nadie.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseAnnotationRepository } from "@/adapters/outbound/clickhouse/clickhouse-annotation-repository";
import { ClickHousePromptEvidenceRepository } from "@/adapters/outbound/clickhouse/clickhouse-prompt-evidence-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseUserFeedbackRepository } from "@/adapters/outbound/clickhouse/clickhouse-user-feedback-repository";
import { configFromEnv, createEvaluationWriteClient, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import type { Annotation } from "@/domain/annotation";
import type { TenantScope } from "@/domain/tenant";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const base = configFromEnv();
const config = { ...base, password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only", writePassword: process.env.CLICKHOUSE_WRITE_USER ? base.writePassword : (process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only") };

const SERVICE = `iso-${randomBytes(4).toString("hex")}`;
const A: TenantScope = { experimentId: `exp-a-${SERVICE}`, serviceName: SERVICE };
const B: TenantScope = { experimentId: `exp-b-${SERVICE}`, serviceName: SERVICE };
const LEGACY_TRACE = randomBytes(16).toString("hex");
const SHARED_TRACE = randomBytes(16).toString("hex"); // el cliente elige ids: dos tenants pueden coincidir
const A_ONLY_TRACE = randomBytes(16).toString("hex");
const SHARED_CONV = `shared-conv-${SERVICE}`;
const RUN = `run-${SERVICE}`;
const hex8 = () => randomBytes(8).toString("hex");
const T0 = Date.now() - 10 * 60_000;
const ts = (offsetMs: number) => new Date(T0 + offsetMs).toISOString().replace("T", " ").replace("Z", "000");
const range = { fromMs: T0 - 30 * 60_000, toMs: Date.now() + 60_000 };

const llm = (tokens: number) => ({ "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-x", "gen_ai.usage.input_tokens": String(tokens), "gen_ai.usage.output_tokens": "1", "gen_ai.conversation.id": SHARED_CONV, "memtrace.step_type": "llm", "memtrace.prompt.name": "iso-prompt", "memtrace.prompt.version": "1", "gen_ai.input.messages": "[]" });
const row = (scope: TenantScope | null, trace: string, name: string, attrs: Record<string, string> = {}, status = "OK", parent = "") => ({
  Timestamp: ts(0), TraceId: trace, SpanId: hex8(), ParentSpanId: parent, SpanName: name, SpanKind: "SPAN_KIND_INTERNAL", ServiceName: SERVICE,
  SpanAttributes: attrs, ResourceAttributes: scope ? { "memtrace.experiment_id": scope.experimentId, "vcs.repository.ref.revision": scope === A ? "a".repeat(40) : "b".repeat(40) } : {},
  Duration: 1e8, StatusCode: `STATUS_CODE_${status}`, StatusMessage: status === "ERROR" ? "boom" : "",
  "Events.Timestamp": [], "Events.Name": [], "Events.Attributes": [],
});
const label = (traceId: string, value: string): Annotation => ({ traceId, spanId: null, configId: "cfg", configName: "tone", dataType: "numeric", annotatorId: "u1", value, comment: null, createdAt: "2026-10-03T10:00:00.000Z" });

describe.skipIf(!enabled)("tenant isolation in ClickHouse (ADR-077)", () => {
  let admin: ClickHouseClient;
  let traces: ClickHouseTraceRepository;
  let scores: ClickHouseScoreRepository;
  let annotations: ClickHouseAnnotationRepository;
  let feedback: ClickHouseUserFeedbackRepository;
  let evidence: ClickHousePromptEvidenceRepository;

  beforeAll(async () => {
    admin = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    const ro = createReadOnlyClient(config);
    traces = new ClickHouseTraceRepository(ro, config.database);
    scores = new ClickHouseScoreRepository(createEvaluationWriteClient(config), ro, config.database);
    annotations = new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), ro, config.database);
    feedback = new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), ro, config.database);
    evidence = new ClickHousePromptEvidenceRepository(ro, config.database);

    const rootA = hex8();
    const rootB = hex8();
    await admin.insert({
      table: `${config.database}.otel_traces`,
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
      values: [
        // el mismo TraceId y la misma conversación existen en los dos tenants, con contenido distinto
        { ...row(A, SHARED_TRACE, "agent-A", llm(1000)), SpanId: rootA },
        row(A, SHARED_TRACE, "tool-A", { "memtrace.step_type": "tool", "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "only-a" }, "ERROR", rootA),
        { ...row(B, SHARED_TRACE, "agent-B", llm(7)), SpanId: rootB },
        row(A, A_ONLY_TRACE, "agent-A2", llm(5)),
        // fila anterior a la migración 013: sin ExperimentId, no la ve nadie
        row(null, LEGACY_TRACE, "agent-legacy", llm(99)),
      ],
    });

    await scores.insertScores(A, RUN, [{ input: "qa", expectedOutput: null, output: "a", traceId: SHARED_TRACE, error: null, scores: [{ name: "ok", value: "true", dataType: "boolean", source: "code", comment: null }] }]);
    await annotations.upsert(A, label(SHARED_TRACE, "1"));
    await feedback.upsert(A, { traceId: SHARED_TRACE, spanId: null, rating: -1, comment: "only A", endUserId: "u", externalMessageId: null, createdAt: "2026-10-06T10:00:00.000Z" });
    await scores.insertScores(B, RUN, [{ input: "qb", expectedOutput: null, output: "b", traceId: SHARED_TRACE, error: null, scores: [{ name: "ok", value: "false", dataType: "boolean", source: "code", comment: null }] }]);
    await annotations.upsert(B, label(SHARED_TRACE, "5"));
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    for (const table of ["otel_traces", "eval_items", "eval_scores", "eval_run_summaries", "annotations", "user_feedback"]) {
      await admin.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE }, clickhouse_settings: settings });
    }
    await admin.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: [SHARED_TRACE, A_ONLY_TRACE, LEGACY_TRACE] }, clickhouse_settings: settings });
    await admin.close();
  });

  it("refuses a scope without experiment or service (it would match pre-migration rows)", async () => {
    await expect(traces.listTraces({ ...range, scope: { experimentId: "", serviceName: SERVICE }, limit: 10 })).rejects.toThrow(/tenant scope/);
    await expect(traces.getTraceSpans({ experimentId: "x", serviceName: "" }, SHARED_TRACE, 10)).rejects.toThrow(/tenant scope/);
  });

  describe("traces", () => {
    it("lists only the caller's traces, never legacy rows", async () => {
      const ids = async (scope: TenantScope) => (await traces.listTraces({ ...range, scope, limit: 50 })).items.map((t) => t.traceId).sort();
      expect(await ids(A)).toEqual([SHARED_TRACE, A_ONLY_TRACE].sort());
      expect(await ids(B)).toEqual([SHARED_TRACE]);
    });

    it("reads a trace id that exists in both tenants as two different traces", async () => {
      expect((await traces.getTraceSpans(A, SHARED_TRACE, 100))!.spans.map((s) => s.name).sort()).toEqual(["agent-A", "tool-A"]);
      expect((await traces.getTraceSpans(B, SHARED_TRACE, 100))!.spans.map((s) => s.name)).toEqual(["agent-B"]);
    });

    it("answers 'not found' for another tenant's trace and for a legacy one", async () => {
      expect(await traces.getTraceSpans(B, A_ONLY_TRACE, 100)).toBeNull();
      expect(await traces.getTraceSpans(A, LEGACY_TRACE, 100)).toBeNull();
      expect(await traces.getTraceSpans(B, LEGACY_TRACE, 100)).toBeNull();
    });

    it("scopes the batch readers by tenant", async () => {
      const spans = await traces.getTraceSpansForTraces(B, [SHARED_TRACE, A_ONLY_TRACE], 100);
      expect([...spans.keys()]).toEqual([SHARED_TRACE]);
      expect(spans.get(SHARED_TRACE)!.spans.map((s) => s.name)).toEqual(["agent-B"]);
      const stats = await traces.getTraceStatsForTraces(B, [SHARED_TRACE, A_ONLY_TRACE]);
      expect([...stats.keys()]).toEqual([SHARED_TRACE]);
      expect(stats.get(SHARED_TRACE)!.byModel[0]!.inputTokens).toBe(7);
    });

    it("lists spans and filters sub-queries (hasErrors) without crossing tenants", async () => {
      expect((await traces.listSpans({ ...range, scope: B, limit: 50 })).items.map((s) => s.name)).toEqual(["agent-B"]);
      // la traza compartida tiene un span fallido solo en A: en B no puede aparecer como "con errores"
      expect((await traces.listTraces({ ...range, scope: B, hasErrors: true, limit: 50 })).items).toEqual([]);
      expect((await traces.listTraces({ ...range, scope: A, hasErrors: true, limit: 50 })).items.map((t) => t.traceId)).toEqual([SHARED_TRACE]);
    });
  });

  describe("conversations (the id is chosen by the client)", () => {
    it("builds the same conversation id independently for each tenant", async () => {
      const retention = { fromMs: Date.now() - 30 * 86_400_000, toMs: Date.now() };
      const a = await traces.getConversation(A, SHARED_CONV, retention);
      const b = await traces.getConversation(B, SHARED_CONV, retention);
      expect(a).toMatchObject({ turnCount: 2, totalTokens: 1000 + 1 + 5 + 1 });
      expect(b).toMatchObject({ turnCount: 1, totalTokens: 7 + 1 });
    });

    it("never returns another tenant's messages, usage or turns", async () => {
      const retention = { fromMs: Date.now() - 30 * 86_400_000, toMs: Date.now() };
      expect((await traces.getConversationMessages(B, SHARED_CONV, retention, 50)).records.map((r) => r.traceId)).toEqual([SHARED_TRACE]);
      expect((await traces.getConversationUsage(B, [SHARED_CONV], Date.now())).get(SHARED_CONV)!.models).toEqual([{ model: "gpt-x", inputTokens: 7, outputTokens: 1 }]);
      expect((await traces.getConversationTraceIds(B, [SHARED_CONV], Date.now())).get(SHARED_CONV)).toEqual([SHARED_TRACE]);
      const list = await traces.listConversations({ ...range, scope: B, limit: 10 });
      expect(list.items.map((c) => [c.conversationId, c.turnCount])).toEqual([[SHARED_CONV, 1]]);
    });
  });

  describe("aggregates", () => {
    it("computes the overview, errors, revisions and catalogs per tenant", async () => {
      const bucketSeconds = 3600;
      expect((await traces.getOverview({ ...range, scope: A, bucketSeconds })).totals.traces).toBe(2);
      expect((await traces.getOverview({ ...range, scope: B, bucketSeconds })).totals.traces).toBe(1);
      expect((await traces.getOverview({ ...range, scope: B, bucketSeconds })).byTool).toEqual([]);
      expect((await traces.listErrorGroups({ ...range, scope: B })).groups).toEqual([]);
      expect((await traces.listErrorGroups({ ...range, scope: A })).groups.length).toBeGreaterThan(0);
      expect((await traces.listRevisions({ ...range, scope: B })).map((r) => r.revision)).toEqual(["b".repeat(40)]);
      expect((await traces.getStepKinds({ ...range, scope: B })).map((k) => k.stepType)).toEqual(["llm"]);
      expect((await traces.getAttributeKeys({ ...range, scope: B, stepTypes: ["llm", "tool"] })).map((k) => k.key)).not.toContain("gen_ai.tool.name");
      const custom = await traces.getCustomMetric({ ...range, scope: B, chartType: "bar", stepTypes: ["tool", "llm"], metric: "count", filters: [], groupByAttribute: null });
      expect(custom.points).toEqual([{ label: "llm", value: 1 }]);
    });

    it("lists services and usage only for the experiments it is given", async () => {
      expect(await traces.listServices(range, [])).toEqual([]);
      expect(await traces.listServices(range, [B])).toContain(SERVICE);
      expect(await traces.listServices(range, [{ experimentId: "exp-nobody", serviceName: SERVICE }])).not.toContain(SERVICE);
      const usage = await traces.getUsageByServices([A, B], range);
      expect(usage.find((u) => u.experimentId === A.experimentId)).toMatchObject({ traces: 2, inputTokens: 1005 });
      expect(usage.find((u) => u.experimentId === B.experimentId)).toMatchObject({ traces: 1, inputTokens: 7 });
    });
  });

  describe("evaluation, annotations, feedback and prompt evidence", () => {
    it("keeps the same dataset run id apart per tenant", async () => {
      const a = await scores.listScoresByRun(A, RUN);
      const b = await scores.listScoresByRun(B, RUN);
      expect(a.map((i) => [i.input, i.scores[0]!.value])).toEqual([["qa", "true"]]);
      expect(b.map((i) => [i.input, i.scores[0]!.value])).toEqual([["qb", "false"]]);
      expect((await scores.aggregateForRuns(B, [RUN]))[0]).toMatchObject({ passRate: 0, count: 1 });
      expect((await scores.listScoresByTrace(B, SHARED_TRACE)).map((s) => s.value)).toEqual(["false"]);
    });

    it("keeps annotations and votes apart even on a trace id both tenants use", async () => {
      expect((await annotations.listForTrace(A, SHARED_TRACE)).map((x) => x.value)).toEqual(["1"]);
      expect((await annotations.listForTrace(B, SHARED_TRACE)).map((x) => x.value)).toEqual(["5"]);
      expect((await feedback.listForTrace(B, SHARED_TRACE))).toEqual([]);
      expect((await feedback.listForTrace(A, SHARED_TRACE)).map((v) => v.comment)).toEqual(["only A"]);
      const day = [Date.parse("2026-10-06T00:00:00Z"), Date.parse("2026-10-07T00:00:00Z")] as const;
      expect((await feedback.summarize(B, ...day)).total).toBe(0);
    });

    it("computes prompt evidence per tenant", async () => {
      const rowsA = await evidence.rowsFor({ ...range, scope: A, promptName: "iso-prompt" });
      const rowsB = await evidence.rowsFor({ ...range, scope: B, promptName: "iso-prompt" });
      expect(rowsA.traces.reduce((n, t) => n + t.traces, 0)).toBe(2);
      expect(rowsB.traces.reduce((n, t) => n + t.traces, 0)).toBe(1);
      expect(rowsB.feedback).toEqual([]);
    });
  });
});
