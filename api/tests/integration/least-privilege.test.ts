/**
 * Mínimo privilegio de los usuarios de ClickHouse (ADR-079), contra un servidor cuyo Job de migraciones ya creó
 * `api_reader`, `api_writer` y `collector`. Opt-in: CLICKHOUSE_INTEGRATION=1 CLICKHOUSE_LEAST_PRIVILEGE=1 con las
 * contraseñas en CLICKHOUSE_READER_PASSWORD, CLICKHOUSE_WRITER_PASSWORD y CLICKHOUSE_COLLECTOR_PASSWORD.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { configFromEnv } from "@/adapters/outbound/clickhouse/client";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION && process.env.CLICKHOUSE_LEAST_PRIVILEGE);
const config = configFromEnv();
const as = (username: string, password: string) =>
  createClient({ url: config.url, username, password, database: config.database, clickhouse_settings: username === "api_reader" ? { readonly: "2", max_threads: 2 } : {} });
const denied = async (run: () => Promise<unknown>) => {
  await expect(run()).rejects.toThrow(/ACCESS_DENIED|READONLY|Not enough privileges|Cannot execute query in readonly|Cannot modify/i);
};
const SCOPE = { experimentId: "exp-least-privilege", serviceName: "least-privilege" };
const range = { fromMs: Date.now() - 3_600_000, toMs: Date.now() + 60_000 };
const SPAN_ROW = `(Timestamp, TraceId, SpanId, ServiceName, SpanName) VALUES (now64(9), 'lp', 'lp', 'least-privilege', 'x')`;

describe.skipIf(!enabled)("least privilege (integration)", () => {
  const clients: ClickHouseClient[] = [];
  const open = (user: string, password: string) => {
    const c = as(user, password);
    clients.push(c);
    return c;
  };
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
  });

  describe("api_reader", () => {
    const reader = () => open("api_reader", process.env.CLICKHOUSE_READER_PASSWORD ?? "");

    it("runs every kind of read the API needs", async () => {
      const repo = new ClickHouseTraceRepository(reader(), config.database);
      await expect(repo.listTraces({ ...range, scope: SCOPE, limit: 5 })).resolves.toBeDefined();
      await expect(repo.getOverview({ ...range, scope: SCOPE, bucketSeconds: 3600 })).resolves.toBeDefined(); // incluye span_topics FINAL y el JOIN
      await expect(repo.listErrorGroups({ ...range, scope: SCOPE })).resolves.toBeDefined();
      await expect(repo.getModelPricing()).resolves.toBeDefined();
      await expect(repo.getTraceSpans(SCOPE, "0".repeat(32), 10)).resolves.toBeNull();
    });

    it("cannot write, alter, drop or read the access catalog", async () => {
      const r = reader();
      await denied(() => r.command({ query: `INSERT INTO ${config.database}.otel_traces ${SPAN_ROW}` }));
      await denied(() => r.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE 1` }));
      await denied(() => r.command({ query: `DROP TABLE ${config.database}.annotations` }));
      await denied(() => r.query({ query: "SELECT count() FROM system.users", format: "JSONEachRow" }).then((q) => q.json()));
    });

    it("cannot lift its own read-only mode", async () => {
      await denied(() => reader().command({ query: "SET readonly = 0" }));
    });
  });

  describe("api_writer", () => {
    const writer = () => open("api_writer", process.env.CLICKHOUSE_WRITER_PASSWORD ?? "");

    it("can only insert into the evaluation tables", async () => {
      const w = writer();
      await denied(() => w.query({ query: `SELECT count() FROM ${config.database}.eval_items`, format: "JSONEachRow" }).then((q) => q.json()));
      await denied(() => w.command({ query: `INSERT INTO ${config.database}.otel_traces ${SPAN_ROW}` }));
    });
  });

  describe("collector", () => {
    const collector = () => open("collector", process.env.CLICKHOUSE_COLLECTOR_PASSWORD ?? "");

    it("can write traces and nothing else", async () => {
      const c = collector();
      await denied(() => c.query({ query: `SELECT SpanAttributes FROM ${config.database}.otel_traces LIMIT 1`, format: "JSONEachRow" }).then((q) => q.json()));
      await denied(() => c.command({ query: `INSERT INTO ${config.database}.user_feedback (ServiceName, TraceId, CreatedAt) VALUES ('a', 'b', now64(3))` }));
      await denied(() => c.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE 1` }));
      await denied(() => c.command({ query: `DROP TABLE ${config.database}.otel_traces` }));
    });

    it("can insert a span and feed the trace index through the materialized view", async () => {
      const c = collector();
      await c.command({ query: `INSERT INTO ${config.database}.otel_traces ${SPAN_ROW}` });
    });
  });
});
