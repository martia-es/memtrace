/**
 * Contra el ClickHouse real. Opt-in: `npm run test:integration`. Comprueba el borrado de retención (ADR-084): solo se van los
 * spans del servicio y anteriores al corte, con sus temáticas, y nada de otro servicio.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configFromEnv, createRetentionClient } from "@/adapters/outbound/clickhouse/client";
import { ClickHouseTracePurger } from "@/adapters/outbound/clickhouse/clickhouse-trace-purger";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
// con CLICKHOUSE_RETENTION_USER (k8s: `retention_worker`) el borrado corre con el usuario de privilegios mínimos, como el CronJob
const purgeClient = () => (process.env.CLICKHOUSE_RETENTION_USER ? createRetentionClient(config) : undefined);
const DAY = 86_400_000;
const SERVICE = `it-purge-${randomBytes(4).toString("hex")}`;
const OTHER = `${SERVICE}-other`;
const id = (n = 16) => randomBytes(n).toString("hex");
const ts = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "000");

describe.skipIf(!enabled)("ClickHouseTracePurger", () => {
  let client: ClickHouseClient;
  const now = Date.now();
  const oldTrace = id();
  const newTrace = id();
  const otherOldTrace = id();

  const count = async (table: string, where: string) => {
    const r = await client.query({ query: `SELECT count() AS n FROM ${config.database}.${table} WHERE ${where}`, format: "JSONEachRow" });
    return Number(((await r.json()) as { n: string }[])[0]!.n);
  };

  beforeAll(async () => {
    client = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    const span = (service: string, trace: string, ageDays: number) => ({
      Timestamp: ts(now - ageDays * DAY),
      TraceId: trace,
      SpanId: id(8),
      ServiceName: service,
      SpanName: "step",
      StatusCode: "OK",
    });
    await client.insert({
      table: `${config.database}.otel_traces`,
      format: "JSONEachRow",
      values: [span(SERVICE, oldTrace, 45), span(SERVICE, oldTrace, 45), span(SERVICE, newTrace, 2), span(OTHER, otherOldTrace, 45)],
    });
    const topic = (trace: string) => ({ TraceId: trace, SpanId: id(8), Topic: "t", Confidence: 0.9, ModelVersion: "v", ExtractedAt: ts(now) });
    await client.insert({ table: `${config.database}.span_topics`, format: "JSONEachRow", values: [topic(oldTrace), topic(newTrace), topic(otherOldTrace)] });
  });

  afterAll(async () => {
    await client.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName IN ({a:String}, {b:String})`, query_params: { a: SERVICE, b: OTHER } });
    await client.command({ query: `ALTER TABLE ${config.database}.span_topics DELETE WHERE TraceId IN ({a:String}, {b:String}, {c:String})`, query_params: { a: oldTrace, b: newTrace, c: otherOldTrace } });
    await client.close();
  });

  it("deletes only the old spans of that service, with their topics", async () => {
    const purger = new ClickHouseTracePurger(purgeClient() ?? client, config.database);
    const result = await purger.purge(SERVICE, new Date(now - 30 * DAY));
    expect(result.spans).toBe(2);

    expect(await count("otel_traces", `ServiceName = '${SERVICE}' AND TraceId = '${oldTrace}'`)).toBe(0);
    expect(await count("otel_traces", `ServiceName = '${SERVICE}' AND TraceId = '${newTrace}'`)).toBe(1);
    expect(await count("otel_traces", `ServiceName = '${OTHER}'`)).toBe(1);
    expect(await count("span_topics", `TraceId = '${oldTrace}'`)).toBe(0);
    expect(await count("span_topics", `TraceId = '${newTrace}'`)).toBe(1);
    expect(await count("span_topics", `TraceId = '${otherOldTrace}'`)).toBe(1);
  });

  it("does nothing when nothing is old enough", async () => {
    const purger = new ClickHouseTracePurger(purgeClient() ?? client, config.database);
    expect((await purger.purge(SERVICE, new Date(now - 30 * DAY))).spans).toBe(0);
    expect(await count("otel_traces", `ServiceName = '${SERVICE}'`)).toBe(1);
  });
});
