import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { ClickHouseTraceRepository } from "@/adapters/outbound/clickhouse/clickhouse-trace-repository";
import { toAttributeKeysResponse } from "@/adapters/inbound/http/mappers";
import { ID_LIKE_VALUE_PATTERN } from "@/domain/attribute-classification";

/** Cliente de ClickHouse que guarda la consulta recibida y contesta con las filas dadas (UInt64 llega como texto, como en el real). */
function fakeClient(rows: unknown[]) {
  const seen: { query: string; query_params: Record<string, unknown> }[] = [];
  const client = {
    query: async (args: { query: string; query_params: Record<string, unknown> }) => {
      seen.push(args);
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
  return { client, seen };
}

const RANGE = { fromMs: 1_700_000_000_000, toMs: 1_700_086_400_000 };

describe("ClickHouseTraceRepository.getAttributeKeys (ADR-077, phase 2)", () => {
  it("measures the values of each key, bounded by range and steps, with every user value bound as a parameter", async () => {
    const { client, seen } = fakeClient([]);
    await new ClickHouseTraceRepository(client).getAttributeKeys({ ...RANGE, stepTypes: ["tool", "weird'; DROP TABLE x; --"], service: "weather" });
    const { query, query_params } = seen[0]!;
    for (const part of ["countIf(value != '')", "uniqIf(value, value != '')", "isFinite(toFloat64OrNull(value))", "avgIf(length(value), value != '')", "ARRAY JOIN mapKeys(SpanAttributes) AS key, mapValues(SpanAttributes) AS value", "GROUP BY key", "LIMIT 200"]) {
      expect(query, part).toContain(part);
    }
    expect(query).toContain(`match(value, '${ID_LIKE_VALUE_PATTERN}')`);
    expect(query).toContain("{stepTypes:Array(String)}");
    expect(query).toContain("ServiceName = {service:String}");
    expect(query).not.toContain("DROP TABLE");
    expect(query_params.stepTypes).toEqual(["tool", "weird'; DROP TABLE x; --"]);
  });

  it("turns the numbers ClickHouse sends as text into statistics", async () => {
    const { client } = fakeClient([{ key: "city", count: "120", nonEmpty: "118", distinct: "7", numericCount: "0", avgLength: 6.5, idLikeCount: "0" }]);
    const keys = await new ClickHouseTraceRepository(client).getAttributeKeys({ ...RANGE, stepTypes: ["tool"] });
    expect(keys).toEqual([{ key: "city", count: 120, nonEmpty: 118, distinct: 7, numericCount: 0, avgLength: 6.5, idLikeCount: 0 }]);
  });

  it("the response carries the classification next to each key", async () => {
    const { client } = fakeClient([
      { key: "city", count: "120", nonEmpty: "120", distinct: "7", numericCount: "0", avgLength: 6, idLikeCount: "0" },
      { key: "customer_id", count: "120", nonEmpty: "120", distinct: "110", numericCount: "120", avgLength: 7, idLikeCount: "0" },
      { key: "order_total", count: "120", nonEmpty: "120", distinct: "95", numericCount: "120", avgLength: 5, idLikeCount: "0" },
    ]);
    const keys = await new ClickHouseTraceRepository(client).getAttributeKeys({ ...RANGE, stepTypes: ["tool"] });
    expect(toAttributeKeysResponse(keys).items).toEqual([
      { key: "city", count: 120, kind: "category", distinct: 7, numeric: false, hiddenByDefault: false },
      { key: "customer_id", count: 120, kind: "id", distinct: 110, numeric: true, hiddenByDefault: true },
      { key: "order_total", count: 120, kind: "number", distinct: 95, numeric: true, hiddenByDefault: false },
    ]);
  });
});
