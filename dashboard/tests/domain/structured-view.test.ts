import { describe, expect, it } from "vitest";
import { structuredRows } from "@/domain/structured-view";

describe("structuredRows", () => {
  it("is null for text, lists and empty objects", () => {
    expect(structuredRows("hello")).toBeNull();
    expect(structuredRows("[1]")).toBeNull();
    expect(structuredRows("{}")).toBeNull();
    expect(structuredRows("{broken")).toBeNull();
  });

  it("reads scalars as fields, flattens one nested level and joins lists of scalars", () => {
    const rows = structuredRows(JSON.stringify({ location: "Granada", current: { temperature_c: 28.1, wind: { kmh: 0.2 } }, tags: ["a", "b"], none: null }))!;
    expect(rows).toEqual([
      { kind: "field", key: "location", value: "Granada" },
      { kind: "field", key: "current.temperature_c", value: "28.1" },
      { kind: "field", key: "current.wind", value: '{"kmh":0.2}' },
      { kind: "field", key: "tags", value: "a, b" },
      { kind: "field", key: "none", value: "–" },
    ]);
  });

  it("shows a list of objects as a table with the columns of its first row", () => {
    const forecast = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${12 + i}`, max: 29 - i, extra: { x: 1 } }));
    const [row] = structuredRows(JSON.stringify({ forecast }))!;
    expect(row).toMatchObject({ kind: "table", key: "forecast", columns: ["date", "max", "extra"], total: 7 });
    expect(row!.kind === "table" && row!.rows[0]).toEqual(["2026-10-12", "29", '{"x":1}']);
  });
});
