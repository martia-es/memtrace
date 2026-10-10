/**
 * Contra el ClickHouse real (`make up`). Opt-in: `npm run test:integration`.
 * Usa un servicio único y borra sus filas al terminar. Requiere la migración 010 aplicada.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseUserFeedbackRepository } from "@/adapters/outbound/clickhouse/clickhouse-user-feedback-repository";
import { configFromEnv, createEvaluationWriteClient, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import type { UserFeedback } from "@/domain/user-feedback";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const SERVICE = `it-fb-${randomBytes(4).toString("hex")}`;
const SCOPE = { experimentId: `exp-${SERVICE}`, serviceName: SERVICE };
const OTHER_SCOPE = { experimentId: "exp-other", serviceName: SERVICE }; // mismo servicio, otro experimento (ADR-077)
const TRACE = randomBytes(16).toString("hex");

const vote = (overrides: Partial<UserFeedback> = {}): UserFeedback => ({
  traceId: TRACE,
  spanId: null,
  rating: 1,
  comment: null,
  endUserId: "u-1",
  externalMessageId: null,
  createdAt: "2026-10-06T10:00:00.000Z",
  ...overrides,
});

describe.skipIf(!enabled)("ClickHouseUserFeedbackRepository (integration)", () => {
  let admin: ClickHouseClient;
  let repo: ClickHouseUserFeedbackRepository;
  const range = [Date.parse("2026-10-06T00:00:00Z"), Date.parse("2026-10-07T00:00:00Z")] as const;

  beforeAll(() => {
    admin = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    repo = new ClickHouseUserFeedbackRepository(createEvaluationWriteClient(config), createReadOnlyClient(config), config.database);
  });

  afterAll(async () => {
    await admin.command({ query: `ALTER TABLE ${config.database}.user_feedback DELETE WHERE ServiceName = {s:String}`, query_params: { s: SERVICE } });
    await admin.close();
  });

  it("a changed vote replaces the previous one; other end users and anonymous votes coexist", async () => {
    await repo.upsert(SCOPE, vote({ rating: 1 }));
    await repo.upsert(SCOPE, vote({ rating: -1, comment: "wrong", createdAt: "2026-10-06T10:01:00.000Z" }));
    await repo.upsert(SCOPE, vote({ endUserId: "u-2", rating: 1, externalMessageId: "msg-7" }));
    await repo.upsert(SCOPE, vote({ endUserId: null, rating: 1 }));

    const found = await repo.listForTrace(SCOPE, TRACE);
    expect(found.map((v) => `${v.endUserId ?? "-"}=${v.rating}`).sort()).toEqual(["-=1", "u-1=-1", "u-2=1"]);
    expect(found.find((v) => v.endUserId === "u-1")?.comment).toBe("wrong");
    expect(found.find((v) => v.endUserId === "u-2")?.externalMessageId).toBe("msg-7");
  });

  it("a tombstone hides the vote", async () => {
    await repo.retract(SCOPE, vote({ endUserId: null, createdAt: "2026-10-06T10:05:00.000Z" }));
    expect((await repo.listForTrace(SCOPE, TRACE)).some((v) => v.endUserId === null)).toBe(false);
  });

  it("summarises and groups by day", async () => {
    expect(await repo.summarize(SCOPE, ...range)).toEqual({ total: 2, up: 1, down: 1, satisfaction: 50, ratedTraces: 1 });
    expect(await repo.daily(SCOPE, ...range)).toEqual([{ day: "2026-10-06", up: 1, down: 1 }]);
    expect((await repo.listRecent(SCOPE, ...range, 10, -1)).map((v) => v.endUserId)).toEqual(["u-1"]);
  });

  it("never returns another experiment's votes, even when it shares the service name (ADR-077)", async () => {
    expect(await repo.listForTrace(OTHER_SCOPE, TRACE)).toEqual([]);
    expect((await repo.summarize(OTHER_SCOPE, ...range)).total).toBe(0);
  });
});
