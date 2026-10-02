import { describe, expect, it } from "vitest";
import { groupAggregatesByRun } from "@/adapters/inbound/http/mappers";
import type { ScoreAggregate } from "@/domain/evaluation";

const aggregate = (overrides: Partial<ScoreAggregate> = {}): ScoreAggregate => ({
  datasetRunId: "run-1",
  name: "exact_match",
  dataType: "boolean",
  passRate: null,
  average: null,
  count: 1,
  ...overrides,
});

describe("groupAggregatesByRun", () => {
  it("groups by datasetRunId and drops that field from the DTO", () => {
    const grouped = groupAggregatesByRun([
      aggregate({ datasetRunId: "run-1", name: "exact_match", passRate: 0.66 }),
      aggregate({ datasetRunId: "run-1", name: "contains", passRate: 1 }),
      aggregate({ datasetRunId: "run-2", name: "exact_match", passRate: 0 }),
    ]);

    expect(grouped.get("run-1")).toEqual([
      { name: "exact_match", dataType: "boolean", passRate: 0.66, average: null, count: 1 },
      { name: "contains", dataType: "boolean", passRate: 1, average: null, count: 1 },
    ]);
    expect(grouped.get("run-2")).toEqual([{ name: "exact_match", dataType: "boolean", passRate: 0, average: null, count: 1 }]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupAggregatesByRun([]).size).toBe(0);
  });
});
