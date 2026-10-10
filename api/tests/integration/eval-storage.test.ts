/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Modelo eval_items / eval_scores (ADR-044) y latencia/tokens leídos de la traza enlazada.
 * Usa un servicio único y borra sus filas al terminar. Requiere las migraciones 001–009. Con `CLICKHOUSE_WRITE_USER`/`CLICKHOUSE_WRITE_PASSWORD` la escritura va con `api_writer` (ADR-045).
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv, createEvaluationWriteClient, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import type { DatasetRunItemSubmission, Score } from "@/domain/evaluation";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const base = configFromEnv();
const config = { ...base, password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only", writePassword: process.env.CLICKHOUSE_WRITE_USER ? base.writePassword : (process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only") };
const SERVICE = `it-eval-${randomBytes(4).toString("hex")}`;
const SCOPE = { experimentId: `exp-${SERVICE}`, serviceName: SERVICE };
const OTHER_SCOPE = { experimentId: "exp-other", serviceName: SERVICE }; // mismo servicio, otro experimento (ADR-077)
const RUN = "run-1";
const TRACE = randomBytes(16).toString("hex");
const hex8 = () => randomBytes(8).toString("hex");
const ts = (offsetMs: number) => new Date(Date.now() - 60_000 + offsetMs).toISOString().replace("T", " ").replace("Z", "000");

const bool = (name: string, value: boolean): Score => ({ name, value: String(value), dataType: "boolean", source: "code", comment: null });
const num = (name: string, value: number): Score => ({ name, value: String(value), dataType: "numeric", source: "code", comment: null });
const judge: Score = { name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: null, judgeModel: "judge-x", judgePromptHash: "abc" };

const item = (input: string, scores: Score[], extra: Partial<DatasetRunItemSubmission> = {}): DatasetRunItemSubmission => ({ input, expectedOutput: "a", output: "a", traceId: null, error: null, scores, ...extra });

describe.skipIf(!enabled)("eval storage (integration)", () => {
  let admin: ClickHouseClient;
  let scores: ClickHouseScoreRepository;
  let traces: ClickHouseTraceRepository;

  beforeAll(async () => {
    admin = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    scores = new ClickHouseScoreRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database);
    traces = new ClickHouseTraceRepository(createReadOnlyClient(config), config.database);
    const root = hex8();
    const span = (spanId: string, parent: string, name: string, durationMs: number, attrs: Record<string, string>) => ({
      Timestamp: ts(0), TraceId: TRACE, SpanId: spanId, ParentSpanId: parent, SpanName: name, SpanKind: "SPAN_KIND_INTERNAL", ServiceName: SERVICE,
      SpanAttributes: attrs, ResourceAttributes: { "memtrace.experiment_id": SCOPE.experimentId }, Duration: durationMs * 1e6, StatusCode: "STATUS_CODE_OK", StatusMessage: "",
      "Events.Timestamp": [], "Events.Name": [], "Events.Attributes": [],
    });
    await admin.insert({
      table: `${config.database}.otel_traces`,
      format: "JSONEachRow",
      values: [
        span(root, "", "eval.item", 1500, {}),
        span(hex8(), root, "chat gpt-x", 400, { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-x", "gen_ai.usage.input_tokens": "100", "gen_ai.usage.output_tokens": "40" }),
        span(hex8(), root, "chat gpt-x", 300, { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-x", "gen_ai.usage.input_tokens": "50", "gen_ai.usage.output_tokens": "10" }),
        span(hex8(), root, "search", 100, { "memtrace.step_type": "retriever" }),
      ],
    });
  });

  afterAll(async () => {
    for (const table of ["eval_items", "eval_scores", "eval_run_summaries", "otel_traces"]) {
      await admin.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE } });
    }
    await admin.close();
  });

  it("stores the item text once and joins it back with every evaluator's score; an item without scores survives", async () => {
    await scores.insertScores(SCOPE, RUN, [
      item("q0", [bool("exact_match", true), num("similarity", 0.5), judge], { traceId: TRACE }),
      item("q1", [bool("exact_match", false), num("similarity", 1), { ...judge, value: "false" }]),
      item("q2", [], { output: null, error: "boom" }),
    ]);

    const items = await scores.listScoresByRun(SCOPE, RUN);

    expect(items.map((i) => i.itemIndex)).toEqual([0, 1, 2]);
    expect(items[0]).toMatchObject({ input: "q0", output: "a", traceId: TRACE });
    expect(items[0]!.scores.map((s) => s.name).sort()).toEqual(["correctness", "exact_match", "similarity"]);
    expect(items[2]).toMatchObject({ input: "q2", error: "boom", scores: [] });

    const counted = await admin.query({ query: `SELECT count() AS rows FROM ${config.database}.eval_items FINAL WHERE ServiceName = {s:String}`, query_params: { s: SERVICE }, format: "JSONEachRow" });
    expect(Number((await counted.json<{ rows: string }>())[0]!.rows)).toBe(3);
  });

  it("is idempotent when a batch is resent (ADR-034)", async () => {
    await scores.insertScores(SCOPE, RUN, [item("q0", [bool("exact_match", true), num("similarity", 0.5), judge], { traceId: TRACE })], 0);
    const items = await scores.listScoresByRun(SCOPE, RUN);
    expect(items).toHaveLength(3);
    expect(items[0]!.scores).toHaveLength(3);
  });

  it("aggregates from the typed column: pass rate of booleans, average of numerics, judge identities", async () => {
    const aggs = await scores.aggregateForRuns(SCOPE, [RUN]);
    const by = (name: string) => aggs.find((a) => a.name === name)!;
    expect(by("exact_match")).toMatchObject({ dataType: "boolean", passRate: 0.5, average: null, count: 2 });
    expect(by("similarity")).toMatchObject({ dataType: "numeric", average: 0.75, passRate: null, count: 2 });
    expect(by("correctness").judges).toEqual([{ model: "judge-x", promptHash: "abc" }]);
  });

  it("lists judge scores for agreement and the automatic scores linked to a trace", async () => {
    expect(await scores.listJudgeScoresForRuns(SCOPE, [RUN], "correctness")).toHaveLength(2);
    const byTrace = await scores.listScoresByTrace(SCOPE, TRACE);
    expect(byTrace.map((s) => s.name).sort()).toEqual(["correctness", "exact_match", "similarity"]);
    expect(await scores.listScoresByTrace(OTHER_SCOPE, TRACE)).toEqual([]);
  });

  it("reads latency (root span) and LLM tokens per model from the linked trace; unknown traces are absent", async () => {
    const stats = await traces.getTraceStatsForTraces(SCOPE, [TRACE, randomBytes(16).toString("hex")]);
    expect(stats.size).toBe(1);
    expect(stats.get(TRACE)).toMatchObject({ traceId: TRACE, durationMs: 1500, byModel: [{ model: "gpt-x", inputTokens: 150, outputTokens: 50 }] });
  });

  it("materializes a completed run's aggregates once and reads them back instead of recomputing (ADR-045)", async () => {
    const run = "run-summary";
    await scores.insertScores(SCOPE, run, [item("q0", [bool("exact_match", true), judge]), item("q1", [bool("exact_match", false), num("similarity", 0.5)])]);
    const live = await scores.aggregateForRuns(SCOPE, [run]);

    await scores.materializeRunSummary(SCOPE, run);
    await scores.materializeRunSummary(SCOPE, run); // idempotente: ReplacingMergeTree por (run, evaluador)
    const stored = await admin.query({ query: `SELECT count() AS n FROM ${config.database}.eval_run_summaries FINAL WHERE ServiceName = {s:String} AND DatasetRunId = {r:String}`, query_params: { s: SERVICE, r: run }, format: "JSONEachRow" });
    expect(Number(((await stored.json<{ n: string }>())[0])!.n)).toBe(3);

    const sorted = (a: typeof live) => [...a].sort((x, y) => x.name.localeCompare(y.name));
    expect(sorted(await scores.aggregateForRuns(SCOPE, [run]))).toEqual(sorted(live));
    expect(live.find((a) => a.name === "exact_match")).toMatchObject({ passRate: 0.5, count: 2 });
    expect(live.find((a) => a.name === "correctness")!.judges).toEqual([{ model: "judge-x", promptHash: "abc" }]);
  });

  it("falls back to the live computation for runs without a stored summary", async () => {
    const run = "run-open";
    await scores.insertScores(SCOPE, run, [item("q0", [num("similarity", 0.25)])]);
    expect(await scores.aggregateForRuns(SCOPE, [run])).toEqual([expect.objectContaining({ name: "similarity", average: 0.25, count: 1 })]);
  });
});
