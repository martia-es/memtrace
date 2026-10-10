/**
 * Contra el ClickHouse real. Opt-in: `npm run test:integration`. La exportación (ADR-084) devuelve solo las filas del servicio y
 * del rango, no las de otros servicios ni las lápidas de anotaciones borradas, y cuenta lo mismo que devuelve.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configFromEnv, createReadOnlyClient } from "@/adapters/outbound/clickhouse/client";
import { ClickHouseDataExporter } from "@/adapters/outbound/clickhouse/clickhouse-data-exporter";

const enabled = Boolean(process.env.CLICKHOUSE_INTEGRATION);
const config = { ...configFromEnv(), password: process.env.CLICKHOUSE_PASSWORD ?? "memtrace-dev-only" };
const SERVICE = `it-export-${randomBytes(4).toString("hex")}`;
const OTHER = `${SERVICE}-other`;
const EXP = `exp-${SERVICE}`;
const OTHER_EXP = `exp-${OTHER}`;
const sc = (serviceName: string) => ({ serviceName, experimentId: serviceName === OTHER ? OTHER_EXP : EXP });
const DAY = 86_400_000;
const id = (n = 16) => randomBytes(n).toString("hex");
const ts = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "000");

describe.skipIf(!enabled)("ClickHouseDataExporter", () => {
  let writer: ClickHouseClient;
  let exporter: ClickHouseDataExporter;
  const now = Date.now();
  const from = new Date(now - 3 * DAY);
  const to = new Date(now + DAY);

  const collect = async (kind: "traces" | "annotations" | "feedback" | "scores", service = SERVICE) => {
    const lines: string[] = [];
    for await (const line of exporter.stream(sc(service), kind, from, to)) lines.push(line);
    return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  };

  beforeAll(async () => {
    writer = createClient({ url: config.url, username: config.username, password: config.password, database: config.database });
    exporter = new ClickHouseDataExporter(createReadOnlyClient(config), config.database);
    const span = (service: string, ageDays: number) => ({ Timestamp: ts(now - ageDays * DAY), TraceId: id(), SpanId: id(8), ServiceName: service, ExperimentId: sc(service).experimentId, SpanName: "step", StatusCode: "OK" });
    await writer.insert({ table: `${config.database}.otel_traces`, format: "JSONEachRow", values: [span(SERVICE, 1), span(SERVICE, 2), span(SERVICE, 20), span(OTHER, 1)] });
    const feedback = (service: string, endUser: string, deleted: number, createdMs: number) => ({
      ServiceName: service, ExperimentId: sc(service).experimentId, TraceId: id(), SpanId: "", EndUserId: endUser, Rating: 1, Comment: null, ExternalMessageId: "", CreatedAt: ts(createdMs), IsDeleted: deleted,
    });
    await writer.insert({ table: `${config.database}.user_feedback`, format: "JSONEachRow", values: [feedback(SERVICE, "kept", 0, now - DAY), feedback(SERVICE, "retracted", 1, now - DAY), feedback(OTHER, "kept", 0, now - DAY)] });
  });
  afterAll(async () => {
    await writer.command({ query: `ALTER TABLE ${config.database}.otel_traces DELETE WHERE ServiceName IN ({a:String}, {b:String})`, query_params: { a: SERVICE, b: OTHER } });
    await writer.command({ query: `ALTER TABLE ${config.database}.user_feedback DELETE WHERE ServiceName IN ({a:String}, {b:String})`, query_params: { a: SERVICE, b: OTHER } });
    await writer.close();
  });

  it("exports only the spans of the service inside the range, and counts the same", async () => {
    const rows = await collect("traces");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ServiceName === SERVICE)).toBe(true);
    expect(await exporter.count(sc(SERVICE), "traces", from, to)).toBe(2);
    expect(await exporter.count(sc(OTHER), "traces", from, to)).toBe(1);
  });

  it("exports every column, so nothing is lost when the schema grows", async () => {
    const [row] = await collect("traces");
    expect(Object.keys(row!)).toEqual(expect.arrayContaining(["Timestamp", "TraceId", "SpanAttributes", "ResourceAttributes", "Duration"]));
  });

  it("leaves out retracted feedback and other services", async () => {
    const rows = await collect("feedback");
    expect(rows.map((r) => r.EndUserId)).toEqual(["kept"]);
    expect(await exporter.count(sc(SERVICE), "feedback", from, to)).toBe(1);
  });

  it("an empty range is an empty file, not an error", async () => {
    const lines: string[] = [];
    for await (const l of exporter.stream(sc(SERVICE), "scores", from, to)) lines.push(l);
    expect(lines).toEqual([]);
  });
});
