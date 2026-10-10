import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { MAX_RETENTION_DAYS, effectiveRetentionDays, retentionCutoff, validateRetentionDays } from "@/domain/retention";

describe("retention rules (ADR-080)", () => {
  it("accepts whole days from 1 to 365", () => {
    expect(validateRetentionDays(1)).toBe(1);
    expect(validateRetentionDays(30)).toBe(30);
    expect(validateRetentionDays(MAX_RETENTION_DAYS)).toBe(365);
  });

  it.each([0, -5, 366, 1.5, NaN, "30", null, undefined])("refuses %s", (value) => {
    expect(() => validateRetentionDays(value)).toThrow(ValidationError);
  });

  it("names the field that failed", () => {
    try {
      validateRetentionDays(400, "days");
    } catch (error) {
      expect((error as ValidationError).fields).toHaveProperty("days");
    }
  });

  it("an override can shorten the organization's retention but never lengthen it", () => {
    expect(effectiveRetentionDays(30, null)).toBe(30);
    expect(effectiveRetentionDays(30, 7)).toBe(7);
    expect(effectiveRetentionDays(30, 90)).toBe(30);
  });

  it("the cutoff is exactly N days before now", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(retentionCutoff(now, 1).toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});
