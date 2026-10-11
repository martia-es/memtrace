/**
 * Contra un ClickHouse real con las migraciones 001-015 aplicadas. Opt-in: `CLICKHOUSE_INTEGRATION=1 npm run test:integration`.
 * Cubre lo que los fakes no pueden: la deduplicación de `model_quality` con FINAL y que `listModelsInUse` solo ve los experimentos dados (ADR-025, ADR-088).
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv } from "@/adapters/outbound/clickhouse/client";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const stamp = randomBytes(4).toString("hex");
const EXP_A = { experimentId: `mq-a-${stamp}`, serviceName: `mq-svc-a-${stamp}` };
const EXP_B = { experimentId: `mq-b-${stamp}`, serviceName: `mq-svc-b-${stamp}` };
const NAMES = [`mq-model-${stamp}-1`, `mq-model-${stamp}-2`];

describe.skipIf(!enabled)("model quality (clickhouse)", () => {
  let client: ClickHouseClient;
  let repo: ClickHouseTraceRepository;
  const db = config.database;

  const qualityRow = (modelName: string, over: Record<string, unknown> = {}) => ({
    Source: "arena", Arena: "text", ModelName: modelName, Organization: "acme", License: "Proprietary",
    Rating: 1400.5, RatingLower: 1397.5, RatingUpper: 1403.5, VoteCount: 1000, Rank: 10,
    PublishedAt: "2026-10-08 00:00:00.000", UpdatedAt: "2026-10-09 03:00:00.000", ...over,
  });
  const span = (service: string, experiment: string, model: string, i: number) =>
    `(now64(9), '${stamp}${i}', '${stamp}${i}', '${service}', 'chat', map('gen_ai.request.model', '${model}'), '${experiment}')`;

  beforeAll(async () => {
    client = createClient({ url: config.url, username: config.username, password: config.password, database: db });
    repo = new ClickHouseTraceRepository(client, db);
    await client.insert({
      table: `${db}.model_quality`,
      format: "JSONEachRow",
      values: [
        qualityRow(NAMES[0]!),
        qualityRow(NAMES[0]!, { Rating: 1410.5, RatingLower: 1408.5, RatingUpper: 1412.5, VoteCount: 1200, Rank: 8, UpdatedAt: "2026-10-10 03:00:00.000", PublishedAt: "2026-10-10 00:00:00.000" }),
        qualityRow(NAMES[1]!, { Source: "other" }),
      ],
    });
    await client.command({
      query: `INSERT INTO ${db}.otel_traces (Timestamp, TraceId, SpanId, ServiceName, SpanName, SpanAttributes, ExperimentId) VALUES
        ${span(EXP_A.serviceName, EXP_A.experimentId, "gpt-5.2", 1)},
        ${span(EXP_A.serviceName, EXP_A.experimentId, "gpt-5.2", 2)},
        ${span(EXP_A.serviceName, EXP_A.experimentId, "claude-sonnet-4-5", 3)},
        ${span(EXP_B.serviceName, EXP_B.experimentId, "mistral-large", 4)},
        ${span(EXP_A.serviceName, EXP_A.experimentId, "", 5)}`,
    });
  });
  afterAll(async () => {
    await client.command({ query: `ALTER TABLE ${db}.model_quality DELETE WHERE ModelName IN ('${NAMES.join("','")}') SETTINGS mutations_sync = 1` });
    await client.command({ query: `ALTER TABLE ${db}.otel_traces DELETE WHERE ExperimentId IN ('${EXP_A.experimentId}','${EXP_B.experimentId}') SETTINGS mutations_sync = 1` });
    await client.close();
  });

  it("returns the latest version of each entry, once, and only the arena text board", async () => {
    const mine = (await repo.getModelQuality()).filter((m) => NAMES.includes(m.modelName));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ modelName: NAMES[0], organization: "acme", license: "Proprietary", rating: 1410.5, ratingLower: 1408.5, ratingUpper: 1412.5, voteCount: 1200, rank: 8 });
    expect(mine[0]!.publishedAtMs).toBe(Date.parse("2026-10-10T00:00:00Z"));
    expect(mine[0]!.updatedAtMs).toBe(Date.parse("2026-10-10T03:00:00Z"));
  });

  it("lists the models in use of the experiments given, and no others", async () => {
    const range = { fromMs: Date.now() - 3_600_000, toMs: Date.now() + 60_000 };
    expect(await repo.listModelsInUse([EXP_A], range)).toEqual(["claude-sonnet-4-5", "gpt-5.2"]);
    expect(await repo.listModelsInUse([EXP_B], range)).toEqual(["mistral-large"]);
    expect(await repo.listModelsInUse([EXP_A, EXP_B], range)).toEqual(["claude-sonnet-4-5", "gpt-5.2", "mistral-large"]);
    expect(await repo.listModelsInUse([], range)).toEqual([]);
    expect(await repo.listModelsInUse([{ experimentId: EXP_A.experimentId, serviceName: "someone-elses" }], range)).toEqual(["claude-sonnet-4-5", "gpt-5.2"]);
  });

  it("respects the time range", async () => {
    expect(await repo.listModelsInUse([EXP_A], { fromMs: Date.now() + 3_600_000, toMs: Date.now() + 7_200_000 })).toEqual([]);
  });
});
