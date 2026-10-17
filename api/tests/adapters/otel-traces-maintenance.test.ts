import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { OtelTracesMaintenance } from "@/adapters/outbound/clickhouse/otel-traces-maintenance";

function fake(opts: { engine?: string; previous?: boolean; partitions?: Array<{ partition: string; parts: string }>; age?: number | null }) {
  const commands: string[] = [];
  const queries: Array<{ query: string; params: Record<string, unknown> }> = [];
  const client = {
    async command({ query }: { query: string }) { commands.push(query.replace(/\s+/g, " ").trim()); },
    async query({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      queries.push({ query, params: query_params });
      let rows: unknown[] = [];
      if (query.includes("FROM system.tables")) {
        const table = query_params.table;
        if (table === "otel_traces") rows = opts.engine ? [{ engine: opts.engine }] : [];
        if (table === "otel_traces_pre_dedup") rows = opts.previous ? [{ engine: "MergeTree" }] : [];
      } else if (query.includes("FROM system.parts")) rows = opts.partitions ?? [];
      else if (query.includes("schema_migrations")) {
        if (opts.age === undefined) throw new Error("table does not exist");
        rows = opts.age === null ? [] : [{ age: String(opts.age) }];
      }
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, commands, queries };
}
const quiet = { log: () => undefined };

describe("OtelTracesMaintenance (ADR-099)", () => {
  it("does nothing while otel_traces is not a ReplacingMergeTree", async () => {
    const f = fake({ engine: "MergeTree" });
    expect(await new OtelTracesMaintenance(f.client, "memtrace", quiet).run()).toEqual({ compacted: [], droppedPrevious: false });
    expect(f.commands).toEqual([]);
  });

  it("compacts each closed partition with more than one part, and only asks for those older than the recent days", async () => {
    const f = fake({ engine: "ReplacingMergeTree", partitions: [{ partition: "2026-10-10", parts: "3" }, { partition: "2026-10-11", parts: "2" }] });
    const report = await new OtelTracesMaintenance(f.client, "memtrace", { ...quiet, recentDays: 2 }).run();
    expect(report.compacted).toEqual(["2026-10-10", "2026-10-11"]);
    expect(f.commands).toEqual(["OPTIMIZE TABLE memtrace.otel_traces PARTITION '2026-10-10' FINAL", "OPTIMIZE TABLE memtrace.otel_traces PARTITION '2026-10-11' FINAL"]);
    const select = f.queries.find((q) => q.query.includes("FROM system.parts"))!;
    expect(select.query).toContain("parts > 1");
    expect(select.params).toMatchObject({ recent: 1, limit: 50 }); // hoy y ayer no se tocan; como mucho 50 por pasada
  });

  it("refuses a partition id that is not a date before putting it in a statement", async () => {
    const f = fake({ engine: "ReplacingMergeTree", partitions: [{ partition: "2026-10-10' ; DROP TABLE x --", parts: "2" }] });
    await expect(new OtelTracesMaintenance(f.client, "memtrace", quiet).run()).rejects.toThrow(/Unexpected partition id/);
    expect(f.commands).toEqual([]);
  });

  it("drops the previous table only after the configured days and only if the swap was verified", async () => {
    const old = fake({ engine: "ReplacingMergeTree", previous: true, age: 8 });
    expect((await new OtelTracesMaintenance(old.client, "memtrace", quiet).run()).droppedPrevious).toBe(true);
    expect(old.commands).toContain("DROP TABLE memtrace.otel_traces_pre_dedup SYNC");

    const young = fake({ engine: "ReplacingMergeTree", previous: true, age: 3 });
    expect((await new OtelTracesMaintenance(young.client, "memtrace", quiet).run()).droppedPrevious).toBe(false);

    const unverified = fake({ engine: "ReplacingMergeTree", previous: true, age: null });
    expect((await new OtelTracesMaintenance(unverified.client, "memtrace", quiet).run()).droppedPrevious).toBe(false);

    const noTable = fake({ engine: "ReplacingMergeTree", previous: true });
    expect((await new OtelTracesMaintenance(noTable.client, "memtrace", quiet).run()).droppedPrevious).toBe(false);
    expect([young, unverified, noTable].flatMap((f) => f.commands).some((c) => c.startsWith("DROP"))).toBe(false);
  });

  it("keeps the previous table forever when keepPreviousDays is 0", async () => {
    const f = fake({ engine: "ReplacingMergeTree", previous: true, age: 999 });
    expect((await new OtelTracesMaintenance(f.client, "memtrace", { ...quiet, keepPreviousDays: 0 }).run()).droppedPrevious).toBe(false);
  });

  it("rejects an invalid database name", () => {
    expect(() => new OtelTracesMaintenance({} as ClickHouseClient, "x; y")).toThrow();
  });
});
