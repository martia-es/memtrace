/**
 * `ClickHouseEpisodeRepository` contra el ClickHouse real (migración 018). Opt-in: `npm run test:integration`.
 * Cubre lo que los fakes no pueden: la consulta con FINAL (gana la última `BuiltAt`), `Nullable(Float32)` de
 * `EvalScore` y el aislamiento por tenant (ADR-088): el mismo TraceId en otro experimento no se mezcla.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseEpisodeRepository } from "@/adapters/outbound/clickhouse/clickhouse-episode-repository";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { uncertainty } from "@/domain/uncertainty";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = configFromEnv();
const SERVICE = `ep-${randomBytes(4).toString("hex")}`;
const A = { experimentId: `exp-a-${SERVICE}`, serviceName: SERVICE };
const B = { experimentId: `exp-b-${SERVICE}`, serviceName: SERVICE };
const now = Date.now();
const ts = (offsetMs = 0) => new Date(now + offsetMs).toISOString().replace("T", " ").replace("Z", "");

const episode = (scope: typeof A, trace: string, over: Record<string, unknown> = {}) => ({
  ServiceName: scope.serviceName, ExperimentId: scope.experimentId, TraceId: trace, StartedAt: ts(), Goal: "g", Answer: "a", Steps: ["chat"], NChat: 1, NTools: 0,
  HasError: 0, Loop: 0, Thumbs: 0, EvalScore: null, Value: 0, Outcome: "ok", Reasons: [], EpisodeVersion: 2, BuiltAt: ts(), ...over,
});

describe.skipIf(!enabled)("episode signals (clickhouse)", () => {
  let writer: ClickHouseClient;
  let repo: ClickHouseEpisodeRepository;
  const t = (n: string) => `${n}-${SERVICE}`;

  beforeAll(async () => {
    writer = createClient({ url: config.url, username: config.writeUsername, password: config.writePassword, database: config.database });
    repo = new ClickHouseEpisodeRepository(createReadOnlyClient(config), config.database);
    await writer.insert({
      table: `${config.database}.mem_episodes`,
      format: "JSONEachRow",
      values: [
        episode(A, t("late"), { Value: 0.1, BuiltAt: ts(-5000) }),
        episode(A, t("late"), { Value: 0.4, Thumbs: -1, EvalScore: 1, Reasons: ["thumbs_down"], BuiltAt: ts(0) }), // la última gana
        episode(A, t("plain")),
        episode(B, t("plain"), { Value: 2, HasError: 1 }), // mismo TraceId, otro experimento
      ],
    });
  });

  afterAll(async () => {
    await writer.close();
  });

  it("reads the latest episode of each trace with its signals", async () => {
    const signals = await repo.signalsForTraces(A, [t("late"), t("plain"), t("missing")]);
    expect([...signals.keys()].sort()).toEqual([t("late"), t("plain")].sort());
    expect(signals.get(t("late"))).toMatchObject({ thumbs: -1, evalScore: 1, hasError: false, reasons: ["thumbs_down"] });
    expect(signals.get(t("late"))!.value).toBeCloseTo(0.4, 5);
    expect(signals.get(t("plain"))!.evalScore).toBeNull();
    expect(uncertainty(signals.get(t("late"))!)).toBe(1); // evaluador OK + 👎 en zona suspect
  });

  it("never returns another tenant's episode for the same trace id", async () => {
    expect(signalsOf(await repo.signalsForTraces(A, [t("plain")]))).toEqual([{ value: 0, hasError: false }]);
    expect(signalsOf(await repo.signalsForTraces(B, [t("plain")]))).toEqual([{ value: 2, hasError: true }]);
  });

  it("returns an empty map without querying when there are no ids", async () => {
    expect((await repo.signalsForTraces(A, [])).size).toBe(0);
  });
});

const signalsOf = (m: Map<string, { value: number; hasError: boolean }>) => [...m.values()].map((s) => ({ value: s.value, hasError: s.hasError }));
