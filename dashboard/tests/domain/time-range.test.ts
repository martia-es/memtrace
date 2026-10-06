import { describe, expect, it } from "vitest";
import { isCustomRange, resolveRange } from "@/domain/time-range";

describe("custom range", () => {
  it("covers whole local days and ignores `now`", () => {
    const r = resolveRange("custom", Date.now(), { from: "2026-10-01", to: "2026-10-03" });
    expect(new Date(r.from).getTime()).toBe(new Date("2026-10-01T00:00:00").getTime());
    expect(new Date(r.to).getTime()).toBe(new Date("2026-10-03T23:59:59.999").getTime());
  });
  it("accepts only well-formed, ordered dates", () => {
    expect(isCustomRange("2026-10-01", "2026-10-01")).toBe(true);
    expect(isCustomRange("2026-10-03", "2026-10-01")).toBe(false);
    expect(isCustomRange("yesterday", "2026-10-01")).toBe(false);
  });
});