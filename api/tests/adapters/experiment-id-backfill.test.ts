import { describe, expect, it } from "vitest";
import { planBackfill } from "@/adapters/outbound/clickhouse/experiment-id-backfill";

describe("planBackfill (ADR-088)", () => {
  it("assigns a service name that belongs to exactly one experiment", () => {
    const plan = planBackfill([
      { id: "e1", serviceName: "chatbot" },
      { id: "e2", serviceName: "weather" },
    ]);
    expect(plan.assign).toEqual([{ id: "e1", serviceName: "chatbot" }, { id: "e2", serviceName: "weather" }]);
    expect(plan.ambiguous).toEqual([]);
  });

  it("does not guess when two organizations share a service name", () => {
    const plan = planBackfill([
      { id: "e1", serviceName: "chatbot" },
      { id: "e2", serviceName: "chatbot" },
      { id: "e3", serviceName: "weather" },
    ]);
    expect(plan.assign).toEqual([{ id: "e3", serviceName: "weather" }]);
    expect(plan.ambiguous).toEqual([{ serviceName: "chatbot", experimentIds: ["e1", "e2"] }]);
  });

  it("plans nothing for no experiments", () => {
    expect(planBackfill([])).toEqual({ assign: [], ambiguous: [] });
  });
});
