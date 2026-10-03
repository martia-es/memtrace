/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Usa un servicio único y borra sus filas al terminar. Requiere las migraciones 005–007 aplicadas.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseAnnotationRepository } from "@/adapters/outbound/clickhouse/clickhouse-annotation-repository";
import { ClickHouseScoreRepository } from "@/adapters/outbound/clickhouse/clickhouse-score-repository";
import { configFromEnv, createEvaluationWriteClient, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import type { Annotation } from "@/domain/annotation";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const SERVICE = `it-ann-${randomBytes(4).toString("hex")}`;
const TRACE = randomBytes(16).toString("hex");

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  traceId: TRACE,
  spanId: null,
  configId: "cfg-1",
  configName: "tone",
  dataType: "numeric",
  annotatorId: "u1",
  value: "3",
  comment: null,
  createdAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});

describe.skipIf(!enabled)("ClickHouseAnnotationRepository (integration)", () => {
  let admin: ClickHouseClient;
  let repo: ClickHouseAnnotationRepository;
  let scores: ClickHouseScoreRepository;

  beforeAll(() => {
    admin = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    repo = new ClickHouseAnnotationRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database);
    scores = new ClickHouseScoreRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database);
  });

  afterAll(async () => {
    for (const table of ["annotations", "eval_items", "eval_scores"]) {
      await admin.command({ query: `ALTER TABLE ${config.database}.${table} DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE } });
    }
    await admin.close();
  });

  it("an edit by the same annotator replaces the label; other annotators and configs coexist", async () => {
    await repo.upsert(SERVICE, annotation({ value: "3", createdAt: "2026-10-03T10:00:00.000Z" }));
    await repo.upsert(SERVICE, annotation({ value: "5", createdAt: "2026-10-03T10:01:00.000Z" }));
    await repo.upsert(SERVICE, annotation({ annotatorId: "u2", value: "2", comment: "meh" }));
    await repo.upsert(SERVICE, annotation({ configId: "cfg-2", configName: "ok", dataType: "boolean", value: "true" }));
    await repo.upsert(SERVICE, annotation({ spanId: "aaaaaaaaaaaaaaaa", value: "1" }));

    const found = await repo.listForTrace(SERVICE, TRACE);
    const view = found.map((a) => `${a.configId}/${a.spanId ?? "-"}/${a.annotatorId}=${a.value}`).sort();
    expect(view).toEqual(["cfg-1/-/u1=5", "cfg-1/-/u2=2", "cfg-1/aaaaaaaaaaaaaaaa/u1=1", "cfg-2/-/u1=true"]);
    expect(found.find((a) => a.annotatorId === "u2")?.comment).toBe("meh");
    expect(found.find((a) => a.value === "5")?.createdAt).toBe("2026-10-03T10:01:00.000Z");
  });

  it("a tombstone hides the label from reads", async () => {
    await repo.retract(SERVICE, annotation({ configId: "cfg-2", configName: "ok", dataType: "boolean", value: "", createdAt: "2026-10-03T10:05:00.000Z" }));
    const found = await repo.listForTrace(SERVICE, TRACE);
    expect(found.some((a) => a.configId === "cfg-2")).toBe(false);
    expect(found.some((a) => a.configId === "cfg-1")).toBe(true);
  });

  it("never returns another tenant's annotations", async () => {
    expect(await repo.listForTrace(`${SERVICE}-other`, TRACE)).toEqual([]);
  });

  it("lists the automatic scores linked to the trace, (an item with no scores contributes nothing)", async () => {
    await scores.insertScores(
      SERVICE,
      "run-1",
      [
        { input: "q", expectedOutput: "a", output: "a", traceId: TRACE, error: null, scores: [{ name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: "ok" }] },
        { input: "q2", expectedOutput: "a", output: null, traceId: TRACE, error: "boom", scores: [] },
      ],
      0,
    );
    expect(await scores.listScoresByTrace(SERVICE, TRACE)).toEqual([
      { datasetRunId: "run-1", itemIndex: 0, name: "correctness", value: "true", dataType: "boolean", source: "llm_judge", comment: "ok" },
    ]);
    expect(await scores.listScoresByTrace(`${SERVICE}-other`, TRACE)).toEqual([]);
  });
});
