import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { OtelTracesDedupe } from "@/adapters/outbound/clickhouse/otel-traces-dedupe";

interface Table { engine: string; sorting_key: string }
const MV = "CREATE MATERIALIZED VIEW memtrace.otel_traces_trace_id_ts_mv TO memtrace.otel_traces_trace_id_ts AS SELECT TraceId, min(Timestamp) AS Start, max(Timestamp) AS End FROM memtrace.otel_traces WHERE TraceId != '' GROUP BY TraceId";

/** Un ClickHouse de mentira: guarda las órdenes y contesta a las consultas con lo que se le diga. */
function fake(tables: Record<string, Table>, opts: { days?: string[]; oldCounts?: number[]; newCounts?: number[]; done?: boolean; hourRows?: number } = {}) {
  const settingsUsed: Array<Record<string, string> | undefined> = [];
  let done = opts.done ?? false;
  const commands: string[] = [];
  const queries: string[] = [];
  const oldCounts = [...(opts.oldCounts ?? [10])];
  const newCounts = [...(opts.newCounts ?? [10])];
  const client = {
    async command({ query, clickhouse_settings }: { query: string; clickhouse_settings?: Record<string, string> }) {
      if (query.startsWith("INSERT INTO memtrace.otel_traces") && query.includes("SELECT *")) settingsUsed.push(clickhouse_settings);
      commands.push(query.replace(/\s+/g, " ").trim());
      if (query.includes("INSERT INTO memtrace.schema_migrations")) done = true;
      if (query.includes("CREATE TABLE IF NOT EXISTS memtrace.schema_migrations")) tables.schema_migrations = { engine: "MergeTree", sorting_key: "version" };
      if (query.startsWith("DROP TABLE")) delete tables.otel_traces_pre_dedup;
      // el intercambio y el cambio de nombre se reflejan en el estado, como en ClickHouse
      if (query.startsWith("EXCHANGE TABLES")) [tables.otel_traces, tables.otel_traces_v2] = [tables.otel_traces_v2!, tables.otel_traces!];
      if (query.startsWith("RENAME TABLE")) { tables.otel_traces_pre_dedup = tables.otel_traces_v2!; delete tables.otel_traces_v2; }
    },
    async query({ query, query_params }: { query: string; query_params?: Record<string, string> }) {
      queries.push(query);
      let rows: unknown[] = [];
      if (query.includes("FROM system.tables") && query.includes("name = {name:String}")) {
        const t = tables[query_params!.name!];
        rows = t ? [t] : [];
      } else if (query.includes("engine = 'MaterializedView'")) rows = [{ name: "otel_traces_trace_id_ts_mv", create_table_query: MV }, { name: "other_mv", create_table_query: "CREATE MATERIALIZED VIEW memtrace.other_mv AS SELECT 1 FROM memtrace.other" }];
      else if (query.includes("toStartOfHour(Timestamp)) AS h")) rows = [{ h: "2026-10-16 10:00:00", n: String(opts.hourRows ?? 100) }];
      else if (query.includes("toDate(Timestamp)) AS d")) rows = (opts.days ?? ["2026-10-16", "2026-10-17"]).map((d) => ({ d }));
      else if (query.includes("now64")) rows = [{ now: "2026-10-17 12:00:00.000" }];
      else if (query.includes("FROM memtrace.schema_migrations")) rows = [{ n: done ? "1" : "0" }];
      else if (query.includes("uniqExact")) rows = [{ n: String(query.includes("otel_traces_pre_dedup") ? oldCounts.shift() ?? 10 : newCounts.shift() ?? 10) }];
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, commands, queries, tables, settingsUsed };
}

const quick = { settleMs: 0, maxRowsPerChunk: 500_000, sleep: async () => undefined, log: () => undefined };
const plain: Record<string, Table> = {
  otel_traces: { engine: "MergeTree", sorting_key: "ServiceName, SpanName, toDateTime(Timestamp)" },
  otel_traces_v2: { engine: "ReplacingMergeTree", sorting_key: "ServiceName, ExperimentId, SpanName, toDateTime(Timestamp), TraceId, SpanId" },
  otel_traces_trace_id_ts: { engine: "MergeTree", sorting_key: "TraceId" },
};

describe("OtelTracesDedupe (ADR-099)", () => {
  it("copies the history day by day, swaps atomically with the views dropped and recreated, then catches up", async () => {
    const f = fake({ ...plain });
    const report = await new OtelTracesDedupe(f.client, "memtrace", quick).run();
    expect(report.status).toBe("completed");
    expect(report.copiedDays).toBe(2);

    const order = f.commands.map((c) => c.split(" ").slice(0, 2).join(" "));
    const copy = order.indexOf("INSERT INTO");
    const drop = order.indexOf("DROP VIEW");
    const exchange = order.indexOf("EXCHANGE TABLES");
    const rename = order.indexOf("RENAME TABLE");
    const create = order.indexOf("CREATE MATERIALIZED");
    expect([copy, drop, exchange, rename, create].every((i) => i >= 0)).toBe(true);
    expect(copy).toBeLessThan(drop);
    expect(drop).toBeLessThan(exchange);
    expect(exchange).toBeLessThan(rename);
    expect(rename).toBeLessThan(create);
    // solo se toca la vista que lee de otel_traces, y se recrea con su definición original
    expect(f.commands.filter((c) => c.startsWith("DROP VIEW"))).toEqual(["DROP VIEW IF EXISTS memtrace.otel_traces_trace_id_ts_mv"]);
    expect(f.commands).toContain(MV);
    expect(f.commands.filter((c) => c.startsWith("INSERT INTO memtrace.otel_traces_v2")).length).toBe(2);
    // el catch-up copia de la antigua a la nueva y rellena el índice de trazas
    expect(f.commands.some((c) => c.startsWith("INSERT INTO memtrace.otel_traces SELECT * FROM memtrace.otel_traces_pre_dedup"))).toBe(true);
    expect(f.commands.some((c) => c.startsWith("INSERT INTO memtrace.otel_traces_trace_id_ts SELECT TraceId"))).toBe(true);
    expect(f.tables.otel_traces!.engine).toBe("ReplacingMergeTree");
    expect(f.commands.some((c) => c.startsWith("INSERT INTO memtrace.schema_migrations"))).toBe(true); // marca de terminado
  });

  it("does not repeat the catch-up on later runs once it was verified, even if the previous table is still there", async () => {
    const f = fake({ otel_traces: { engine: "ReplacingMergeTree", sorting_key: "x" }, otel_traces_pre_dedup: { engine: "MergeTree", sorting_key: "y" }, schema_migrations: { engine: "MergeTree", sorting_key: "version" } }, { done: true });
    const report = await new OtelTracesDedupe(f.client, "memtrace", quick).run();
    expect(report.status).toBe("already-deduplicated");
    expect(f.commands).toEqual([]);
  });

  it("drops the previous table only after the swap was verified", async () => {
    const pending = fake({ otel_traces: { engine: "ReplacingMergeTree", sorting_key: "x" }, otel_traces_pre_dedup: { engine: "MergeTree", sorting_key: "y" }, schema_migrations: { engine: "MergeTree", sorting_key: "version" } });
    await expect(new OtelTracesDedupe(pending.client, "memtrace", quick).dropPrevious()).rejects.toThrow(/refusing to drop/);
    expect(pending.commands).toEqual([]);
    const verified = fake({ otel_traces: { engine: "ReplacingMergeTree", sorting_key: "x" }, otel_traces_pre_dedup: { engine: "MergeTree", sorting_key: "y" }, schema_migrations: { engine: "MergeTree", sorting_key: "version" } }, { done: true });
    expect(await new OtelTracesDedupe(verified.client, "memtrace", quick).dropPrevious()).toBe(true);
    expect(verified.commands).toEqual(["DROP TABLE memtrace.otel_traces_pre_dedup SYNC"]);
  });

  it("copies in small blocks with few threads, and splits an hour with many rows into chunks by hash of the trace id", async () => {
    const f = fake({ ...plain }, { days: ["2026-10-16"], hourRows: 1_200_000 });
    await new OtelTracesDedupe(f.client, "memtrace", { ...quick, maxRowsPerChunk: 500_000 }).run();
    const history = f.commands.filter((c) => c.startsWith("INSERT INTO memtrace.otel_traces_v2"));
    expect(history).toHaveLength(3); // 1.200.000 / 500.000 -> 3 trozos
    expect(history.every((c) => c.includes("cityHash64(TraceId) % {chunks:UInt32} = {k:UInt32}"))).toBe(true);
    expect(f.settingsUsed.length).toBeGreaterThan(0);
    for (const settings of f.settingsUsed) {
      expect(settings).toMatchObject({ max_threads: "2", max_insert_block_size: "65536" });
    }
  });

  it("does not add the hash predicate when an hour fits in one chunk", async () => {
    const f = fake({ ...plain }, { days: ["2026-10-16"], hourRows: 1000 });
    await new OtelTracesDedupe(f.client, "memtrace", quick).run();
    expect(f.commands.filter((c) => c.startsWith("INSERT INTO memtrace.otel_traces_v2"))).toHaveLength(1);
    expect(f.commands.some((c) => c.includes("cityHash64"))).toBe(false);
  });

  it("does nothing when the table is already deduplicated and there is no previous table", async () => {
    const f = fake({ otel_traces: { engine: "ReplacingMergeTree", sorting_key: "x" } });
    const report = await new OtelTracesDedupe(f.client, "memtrace", quick).run();
    expect(report.status).toBe("already-deduplicated");
    expect(f.commands).toEqual([]);
  });

  it("resumes the catch-up when the swap was done but a previous table is still there, without swapping back", async () => {
    const f = fake({ otel_traces: { engine: "ReplacingMergeTree", sorting_key: "x" }, otel_traces_pre_dedup: { engine: "MergeTree", sorting_key: "y" }, otel_traces_trace_id_ts: { engine: "MergeTree", sorting_key: "TraceId" } });
    const report = await new OtelTracesDedupe(f.client, "memtrace", quick).run();
    expect(report.status).toBe("resumed");
    expect(f.commands.some((c) => c.startsWith("EXCHANGE") || c.startsWith("RENAME") || c.startsWith("DROP"))).toBe(false);
  });

  it("refuses to swap when migration 017 has not created the new table", async () => {
    const f = fake({ otel_traces: plain.otel_traces! });
    await expect(new OtelTracesDedupe(f.client, "memtrace", quick).run()).rejects.toThrow(/migration 017 has not run/);
    expect(f.commands).toEqual([]);
  });

  it("refuses to swap when the new table does not have the identity of a span in its key", async () => {
    const f = fake({ ...plain, otel_traces_v2: { engine: "ReplacingMergeTree", sorting_key: "ServiceName, SpanName, TraceId, SpanId" } });
    await expect(new OtelTracesDedupe(f.client, "memtrace", quick).run()).rejects.toThrow(/ExperimentId/);
    expect(f.commands).toEqual([]);
  });

  it("retries the catch-up while spans are missing, and fails (keeping the previous table) if they never arrive", async () => {
    const ok = fake({ ...plain }, { oldCounts: [10, 10], newCounts: [8, 10] });
    const report = await new OtelTracesDedupe(ok.client, "memtrace", quick).run();
    expect(report.windowSpans).toEqual({ old: 10, new: 10 });
    expect(ok.commands.filter((c) => c.startsWith("INSERT INTO memtrace.otel_traces SELECT")).length).toBe(2);

    const bad = fake({ ...plain }, { oldCounts: [10, 10, 10], newCounts: [7, 7, 7] });
    await expect(new OtelTracesDedupe(bad.client, "memtrace", quick).run()).rejects.toThrow(/still misses 3 span/);
    expect(bad.tables.otel_traces_pre_dedup).toBeDefined(); // la tabla antigua se conserva
  });

  it("rejects an invalid database name", () => {
    expect(() => new OtelTracesDedupe({} as ClickHouseClient, "bad name; DROP")).toThrow();
  });
});
