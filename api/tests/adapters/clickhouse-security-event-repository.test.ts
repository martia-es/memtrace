import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { ClickHouseSecurityEventRepository } from "@/adapters/outbound/clickhouse/clickhouse-security-event-repository";
import { RepositoryUnavailableError } from "@/application/errors";

const scope = { experimentId: "exp-1", serviceName: "weather" };

function fakeClient(rows: unknown[] | Error) {
  const query = vi.fn(async (_: unknown) => {
    if (rows instanceof Error) throw rows;
    return { json: async () => rows };
  });
  return { client: { query } as unknown as ClickHouseClient, query };
}

describe("ClickHouseSecurityEventRepository", () => {
  it("counts only detections of the tenant, in one deduplicated query, and never selects content", async () => {
    const { client, query } = fakeClient([]);
    await new ClickHouseSecurityEventRepository(client).countEvents({ fromMs: 1000, toMs: 2000, scope });
    const call = query.mock.calls[0]![0] as { query: string; query_params: Record<string, unknown>; clickhouse_settings: Record<string, unknown> };
    expect(query).toHaveBeenCalledTimes(1);
    expect(call.query).toContain("ServiceName = {tenantService:String} AND ExperimentId = {tenantExperiment:String}");
    expect(call.query).toContain("startsWith(SpanName, 'security.')");
    expect(call.query).toContain("SpanAttributes['security.detected'] = 'true'");
    expect(call.query).toContain("SpanAttributes['memtrace.playground'] != 'true'");
    expect(call.query).not.toMatch(/gen_ai\.(input|output)|memtrace\.(input|output)/);
    expect(call.query_params).toEqual({ fromMs: 1000, toMs: 2000, tenantService: "weather", tenantExperiment: "exp-1" });
    expect(call.clickhouse_settings).toMatchObject({ final: 1 });
  });

  it("maps rows and fills missing attributes", async () => {
    const { client } = fakeClient([
      { detector: "secret_leak", category: "secret_leak", severity: "error", action: "blocked", day: "2026-10-24", events: "3" },
      { detector: "pii_leak", category: "", severity: "", action: "", day: "2026-10-25", events: 1 },
    ]);
    const rows = await new ClickHouseSecurityEventRepository(client).countEvents({ fromMs: 0, toMs: 1, scope });
    expect(rows).toEqual([
      { detector: "secret_leak", category: "secret_leak", severity: "error", action: "blocked", day: "2026-10-24", count: 3 },
      { detector: "pii_leak", category: "unknown", severity: "unknown", action: "observed", day: "2026-10-25", count: 1 },
    ]);
  });

  it("refuses a query without tenant scope", async () => {
    const { client, query } = fakeClient([]);
    await expect(new ClickHouseSecurityEventRepository(client).countEvents({ fromMs: 0, toMs: 1, scope: { experimentId: "", serviceName: "" } })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("reports an unavailable store", async () => {
    const { client } = fakeClient(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(new ClickHouseSecurityEventRepository(client).countEvents({ fromMs: 0, toMs: 1, scope })).rejects.toBeInstanceOf(RepositoryUnavailableError);
  });
});
