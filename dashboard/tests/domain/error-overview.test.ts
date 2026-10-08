import { describe, expect, it } from "vitest";
import { errorTrend, impactLabel } from "@/domain/error-overview";

describe("errorTrend", () => {
  it("is null when there is no previous period to compare with", () => {
    expect(errorTrend(5, 0, false)).toBeNull();
  });
  it("flags causes that did not exist before", () => {
    expect(errorTrend(5, 0, true)).toEqual({ kind: "new", label: "New in this period" });
  });
  it("reports growth, decline and stability", () => {
    expect(errorTrend(15, 10, true)).toMatchObject({ kind: "up" });
    expect(errorTrend(5, 10, true)).toMatchObject({ kind: "down" });
    expect(errorTrend(10, 10, true)).toMatchObject({ kind: "same" });
  });
});

describe("impactLabel", () => {
  it("prefers conversations with their share", () => {
    expect(impactLabel(12, 50, 20)).toBe("12 conversations (24%)");
    expect(impactLabel(1, 50, 1)).toContain("1 conversation (");
  });
  it("falls back to executions when conversations are not identified", () => {
    expect(impactLabel(0, 0, 3)).toBe("3 executions");
  });
});
