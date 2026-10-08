/**
 * Contra un Postgres y un ClickHouse reales con las migraciones aplicadas. Opt-in:
 * `POSTGRES_INTEGRATION_URL=postgres://… CLICKHOUSE_INTEGRATION=1 npm run test:integration`.
 * Gate de promoción de prompts de punta a punta (ADR-070): la política en Postgres, los runs de evaluación y su vínculo con
 * la versión del prompt a través de las trazas en ClickHouse, el criterio de pase y el historial de los movimientos.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHousePromptEvidenceRepository } from "@/adapters/outbound/clickhouse/clickhouse-prompt-evidence-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { PostgresPromptRepository } from "@/adapters/outbound/postgres/postgres-prompt-repository";
import { PostgresScoreConfigRepository } from "@/adapters/outbound/postgres/postgres-score-config-repository";
import { PromptGateService } from "@/application/prompt-gate-service";
import { PromptService } from "@/application/prompt-service";
import { PromptGateBlockedError, PromptInvariantError } from "@/domain/errors";

const pgUrl = process.env.POSTGRES_INTEGRATION_URL;
const chEnabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };

const stamp = Date.now();
const SERVICE = `gate-${randomBytes(4).toString("hex")}`;
const PROMPT = "gated-prompt";
const hex = (n: number) => randomBytes(n).toString("hex");
const T0 = Date.now() - 10 * 60_000;
const ts = (offsetMs: number) => new Date(T0 + offsetMs).toISOString().replace("T", " ").replace("Z", "000");

describe.skipIf(!pgUrl || !chEnabled)("prompt promotion gate (postgres + clickhouse)", () => {
  let pool: Pool;
  let writer: ClickHouseClient;
  let identity: PostgresIdentityRepository;
  let prompts: PostgresPromptRepository;
  let scores: ClickHouseScoreRepository;
  let service: PromptService;
  let gate: PromptGateService;
  let orgId: string;
  let userId: string;
  let experimentId: string;
  let datasetId: string;
  let otherDatasetId: string;
  let promptId: string;
  const traceIds: string[] = [];
  const runIds: string[] = [];

  /** Un run de evaluación: cada item tiene una traza cuyo span usa `versions[i]` del prompt, y un score booleano. */
  async function makeRun(dataset: string, name: string, versions: number[], passes: boolean[], status: "running" | "completed" = "completed") {
    const version = (await identity.getLatestDatasetVersion(dataset))!;
    const run = await identity.createDatasetRun(crypto.randomUUID(), dataset, version.id, name, versions.length, status);
    runIds.push(run.id);
    const spans = versions.map((v, i) => {
      const trace = hex(16);
      traceIds.push(trace);
      return { trace, v, i };
    });
    await writer.insert({
      table: `${config.database}.otel_traces`,
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
      values: spans.map(({ trace, v, i }) => ({
        Timestamp: ts(i * 10), TraceId: trace, SpanId: hex(8), ParentSpanId: "", SpanName: "llm", SpanKind: "SPAN_KIND_INTERNAL", ServiceName: SERVICE,
        SpanAttributes: { "memtrace.prompt.name": PROMPT, "memtrace.prompt.version": String(v) }, ResourceAttributes: {}, Duration: 1e8,
        StatusCode: "STATUS_CODE_OK", StatusMessage: "", "Events.Timestamp": [], "Events.Name": [], "Events.Attributes": [],
      })),
    });
    await scores.insertScores(
      SERVICE,
      run.id,
      spans.map(({ trace, i }) => ({
        itemIndex: i, input: `q${i}`, expectedOutput: null, output: "a", traceId: trace, error: null,
        scores: [{ name: "accurate", value: String(passes[i]), dataType: "boolean" as const, source: "code" as const, comment: null }],
      })),
    );
    return run.id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: pgUrl });
    writer = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    identity = new PostgresIdentityRepository(pool);
    prompts = new PostgresPromptRepository(pool);
    scores = new ClickHouseScoreRepository(writer, createReadOnlyClient(config), config.database);
    gate = new PromptGateService(prompts, identity, scores, new PostgresScoreConfigRepository(pool), new ClickHousePromptEvidenceRepository(createReadOnlyClient(config), config.database));
    service = new PromptService(prompts, gate);

    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`gate-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`gate-org-${stamp}`, userId)).id;
    experimentId = (await identity.createExperiment(orgId, "weather", SERVICE)).id;
    datasetId = (await identity.createDataset(experimentId, userId, "golden")).id;
    otherDatasetId = (await identity.createDataset(experimentId, userId, "other")).id;

    const created = await service.create(orgId, userId, { name: PROMPT, content: "uno", experimentIds: [experimentId] });
    promptId = created.prompt.id;
    await service.saveVersion(promptId, userId, { content: "dos" });
    await service.saveVersion(promptId, userId, { content: "tres" });
    await service.saveVersion(promptId, userId, { content: "cuatro" }); // v4: solo para probar el prompt sin política
  });

  afterAll(async () => {
    const settings = { mutations_sync: "1" as const };
    for (const table of ["otel_traces", "eval_items", "eval_scores", "eval_run_summaries"]) {
      await writer.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE }, clickhouse_settings: settings });
    }
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces_trace_id_ts DELETE WHERE TraceId IN {ids:Array(String)}`, query_params: { ids: traceIds }, clickhouse_settings: settings });
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [`gate-${stamp}@example.com`]);
    await writer.close();
    await pool.end();
  });

  const promote = (version: number, extra: { bypassReason?: string | null } = {}, canBypass = false) =>
    service.moveTag(promptId, userId, { tag: "pro", version, ...extra }, true, canBypass);

  it("is free while the prompt has no policy", async () => {
    await expect(promote(4)).resolves.toMatchObject({ gateVerdict: "no_policy" });
    await service.moveTag(promptId, userId, { tag: "pro", version: null }, true);
  });

  it("only accepts a dataset of one of the prompt's agents", async () => {
    const foreignExperiment = (await identity.createExperiment(orgId, "other-agent", `${SERVICE}-other`)).id;
    const foreignDataset = (await identity.createDataset(foreignExperiment, userId, "foreign")).id;
    const prompt = await service.get(promptId);
    await expect(gate.setPolicy(prompt, userId, { datasetId: foreignDataset, requiredRuns: 1 })).rejects.toBeInstanceOf(PromptInvariantError);
  });

  it("with a policy: dev stays free, pre and pro need an evaluation of exactly that version", async () => {
    await gate.setPolicy(await service.get(promptId), userId, { datasetId, requiredRuns: 1 });
    await expect(service.moveTag(promptId, userId, { tag: "dev", version: 3 }, true)).resolves.toMatchObject({ gateVerdict: "not_gated" });
    const blocked = await promote(3).catch((e) => e);
    expect(blocked).toBeInstanceOf(PromptGateBlockedError);
    expect(blocked.gate).toMatchObject({ verdict: "no_evaluation" });
    expect(await service.moveTag(promptId, userId, { tag: "pre", version: 3 }, true).catch((e) => e)).toBeInstanceOf(PromptGateBlockedError);
    expect((await service.detail(promptId)).tags.map((t) => t.tag)).toEqual(["dev"]); // the blocked moves left nothing behind
  });

  it("attributes a run to the version its items' traces used, and passes when the evaluators reach their target", async () => {
    await makeRun(datasetId, "v1 run", [1, 1, 1, 1], [true, true, true, true]);
    await expect(gate.check(await service.get(promptId), "pro", 1)).resolves.toMatchObject({ allowed: true, verdict: "allowed" });
    // that run says nothing about v2
    await expect(gate.check(await service.get(promptId), "pro", 2)).resolves.toMatchObject({ allowed: false, verdict: "no_evaluation" });
  });

  it("blocks a version whose evaluation fails and explains which evaluator", async () => {
    await makeRun(datasetId, "v2 run", [2, 2, 2, 2], [true, false, false, false]);
    const result = await gate.check(await service.get(promptId), "pro", 2);
    expect(result).toMatchObject({ allowed: false, verdict: "failed" });
    expect(result.reason).toContain("accurate 25% (target 80%)");
  });

  it("ignores runs that mix versions and runs of another dataset", async () => {
    await makeRun(datasetId, "mixed run", [3, 3, 1, 3], [true, true, true, true]); // one item used v1: proves nothing about v3
    await makeRun(otherDatasetId, "other dataset", [3, 3, 3, 3], [true, true, true, true]);
    await expect(gate.check(await service.get(promptId), "pro", 3)).resolves.toMatchObject({ allowed: false, verdict: "no_evaluation" });
  });

  it("waits for a run that is still uploading", async () => {
    await makeRun(datasetId, "v3 running", [3, 3], [true, true], "running");
    await expect(gate.check(await service.get(promptId), "pro", 3)).resolves.toMatchObject({ allowed: false, verdict: "evaluation_running" });
  });

  it("promotes with a passing run, records the verdict, and going back to it later needs no new evaluation", async () => {
    const event = await promote(1);
    expect(event).toMatchObject({ toVersion: 1, gateVerdict: "allowed", gateBypassed: false });
    await expect(promote(2)).rejects.toBeInstanceOf(PromptGateBlockedError);
    await service.moveTag(promptId, userId, { tag: "pro", version: null }, true);
    // v1 was served in pro without skipping the gate: coming back is a rollback
    await expect(promote(1)).resolves.toMatchObject({ gateVerdict: "rollback" });
  });

  it("lets governance skip the gate with a reason, and a bypassed version is NOT a valid rollback later", async () => {
    const event = await promote(2, { bypassReason: "Hotfix: the old answer broke checkout" }, true);
    expect(event).toMatchObject({ gateVerdict: "failed", gateBypassed: true, bypassReason: "Hotfix: the old answer broke checkout" });
    await promote(1); // back to the evaluated one (rollback)
    const again = await promote(2).catch((e) => e);
    expect(again).toBeInstanceOf(PromptGateBlockedError); // going back to the bypassed version is promoting it again
    expect((await service.detail(promptId)).events.find((e) => e.gateBypassed)).toMatchObject({ toVersion: 2, tag: "pro" });
  });

  it("needs as many passing runs in a row as the policy says", async () => {
    await gate.setPolicy(await service.get(promptId), userId, { datasetId, requiredRuns: 2 });
    await makeRun(datasetId, "v3 pass A", [3, 3, 3, 3], [true, true, true, true]);
    await expect(gate.check(await service.get(promptId), "pre", 3)).resolves.toMatchObject({ allowed: false, verdict: "insufficient_runs" });
    await makeRun(datasetId, "v3 pass B", [3, 3, 3, 3], [true, true, true, true]);
    await expect(gate.check(await service.get(promptId), "pre", 3)).resolves.toMatchObject({ allowed: true, verdict: "allowed", requiredRuns: 2 });
  });

  it("does not open by itself when the policy's dataset is deleted", async () => {
    await gate.setPolicy(await service.get(promptId), userId, { datasetId: otherDatasetId, requiredRuns: 1 });
    await pool.query(`DELETE FROM datasets WHERE id = $1`, [otherDatasetId]);
    expect(await gate.getPolicy(promptId)).toMatchObject({ datasetId: null });
    await expect(gate.check(await service.get(promptId), "pro", 3)).resolves.toMatchObject({ allowed: false, verdict: "policy_incomplete" });
  });

  it("removing the policy opens every environment again", async () => {
    await gate.deletePolicy(await service.get(promptId));
    expect(await gate.getPolicy(promptId)).toBeNull();
    await expect(promote(3)).resolves.toMatchObject({ gateVerdict: "no_policy" });
  });
});
