/**
 * Backfill de ExperimentId contra el ClickHouse real (ADR-077): las filas anteriores a la migración 013 valen '' y no las
 * ve nadie; el backfill las asigna cuando el servicio es de un solo experimento y deja el resto sin tocar.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { ClickHouseUserFeedbackRepository } from "@/adapters/outbound/clickhouse/clickhouse-user-feedback-repository";
import { configFromEnv, createEvaluationWriteClient, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { ExperimentIdBackfill, planBackfill } from "@/adapters/outbound/clickhouse/experiment-id-backfill";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const base = configFromEnv();
const config = { ...base, password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only", writePassword: process.env.CLICKHOUSE_WRITE_USER ? base.writePassword : (process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only") };

const id = randomBytes(4).toString("hex");
const OWNED = `bf-owned-${id}`;
const SHARED = `bf-shared-${id}`;
const EXP_OWNED = `exp-owned-${id}`;
const TRACE = randomBytes(16).toString("hex");
const TRACE_SHARED = randomBytes(16).toString("hex");
const NOW = "2026-10-06 10:00:00.000";
const range = { fromMs: Date.now() - 3_600_000, toMs: Date.now() + 60_000 };

describe.skipIf(!enabled)("ExperimentIdBackfill (integration)", () => {
  let admin: ClickHouseClient;
  let backfill: ExperimentIdBackfill;

  const span = (service: string, trace: string) => ({
    Timestamp: new Date(Date.now() - 60_000).toISOString().replace("T", " ").replace("Z", "000"), TraceId: trace, SpanId: randomBytes(8).toString("hex"), ParentSpanId: "", SpanName: "legacy",
    SpanKind: "SPAN_KIND_INTERNAL", ServiceName: service, SpanAttributes: {}, ResourceAttributes: {}, Duration: 1e6, StatusCode: "STATUS_CODE_OK", StatusMessage: "",
    "Events.Timestamp": [], "Events.Name": [], "Events.Attributes": [],
  });

  beforeAll(async () => {
    admin = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    backfill = new ExperimentIdBackfill(admin, config.database);
    // filas "legacy": se insertan sin ExperimentId, como las dejó el código anterior a la migración
    const insert = (table: string, values: object[]) => admin.insert({ table: `${config.database}.${table}`, values, format: "JSONEachRow", clickhouse_settings: { date_time_input_format: "best_effort" } });
    await insert("otel_traces", [span(OWNED, TRACE), span(SHARED, TRACE_SHARED)]);
    for (const service of [OWNED, SHARED]) {
      await insert("user_feedback", [{ ServiceName: service, TraceId: service === OWNED ? TRACE : TRACE_SHARED, SpanId: "", EndUserId: "u", Rating: 1, Comment: null, ExternalMessageId: "", CreatedAt: NOW, IsDeleted: 0 }]);
      await insert("eval_items", [{ ServiceName: service, DatasetRunId: `run-${service}`, ItemIndex: 0, TraceId: null, Input: '"q"', Output: '"a"', ExpectedOutput: null, Error: null, CreatedAt: NOW }]);
      await insert("eval_scores", [{ ServiceName: service, DatasetRunId: `run-${service}`, ItemIndex: 0, Name: "ok", Value: "true", ValueNum: 1, DataType: "boolean", Source: "code", Comment: null, JudgeModel: null, JudgePromptHash: null, CreatedAt: NOW }]);
    }
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    for (const table of ["otel_traces", "eval_items", "eval_scores", "eval_run_summaries", "annotations", "user_feedback"]) {
      await admin.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName IN ({a:String}, {b:String})`, query_params: { a: OWNED, b: SHARED }, clickhouse_settings: settings });
    }
    await admin.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: [TRACE, TRACE_SHARED] }, clickhouse_settings: settings });
    await admin.close();
  });

  it("legacy rows are invisible before the backfill", async () => {
    const traces = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database);
    expect((await traces.listTraces({ ...range, scope: { experimentId: EXP_OWNED, serviceName: OWNED }, limit: 10 })).items).toEqual([]);
  });

  it("assigns a service that belongs to one experiment and leaves a shared one untouched", async () => {
    const plan = planBackfill([
      { id: EXP_OWNED, serviceName: OWNED },
      { id: "exp-x", serviceName: SHARED },
      { id: "exp-y", serviceName: SHARED },
    ]);
    const counts = await backfill.run(plan.assign);
    expect(counts.map((c) => c.table).sort()).toEqual(["eval_items", "eval_scores", "otel_traces", "user_feedback"]);

    const ro = createReadOnlyClient(config);
    const scope = { experimentId: EXP_OWNED, serviceName: OWNED };
    expect((await new ClickHouseTraceRepository(ro, config.database).listTraces({ ...range, scope, limit: 10 })).items.map((t) => t.traceId)).toEqual([TRACE]);
    expect((await new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), ro, config.database).listForTrace(scope, TRACE)).length).toBe(1);
    expect((await new ClickHouseScoreRepository(createEvaluationWriteClient(config), ro, config.database).listScoresByRun(scope, `run-${OWNED}`)).map((i) => i.scores[0]!.value)).toEqual(["true"]);

    const left = (await backfill.unassigned()).filter((l) => l.serviceName === OWNED || l.serviceName === SHARED);
    expect(left.every((l) => l.serviceName === SHARED)).toBe(true);
    expect(left.map((l) => l.table).sort()).toEqual(["eval_items", "eval_scores", "otel_traces", "user_feedback"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const plan = planBackfill([{ id: EXP_OWNED, serviceName: OWNED }]);
    expect(await backfill.run(plan.assign)).toEqual([]);
    const ro = createReadOnlyClient(config);
    const feedback = new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), ro, config.database);
    expect((await feedback.listForTrace({ experimentId: EXP_OWNED, serviceName: OWNED }, TRACE)).length).toBe(1);
  });
});
