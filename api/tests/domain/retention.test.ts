import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { AI_ACT_MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, defaultRetentionDays, minRetentionDays, retentionCutoff, retentionDaysFor, validateLevelRetention, validateRetentionDays, type RetentionDaysByLevel } from "@/domain/retention";

describe("retention rules (ADR-084)", () => {
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

  it("high-risk and unclassified agents cannot keep traces less than the AI Act floor; the other levels can", () => {
    expect(AI_ACT_MIN_RETENTION_DAYS).toBe(180);
    for (const level of ["high", "unclassified"] as const) {
      expect(minRetentionDays(level)).toBe(180);
      expect(() => validateLevelRetention(level, 179)).toThrow(ValidationError);
      expect(validateLevelRetention(level, 180)).toBe(180);
      expect(validateLevelRetention(level, 365)).toBe(365);
    }
    for (const level of ["limited", "minimal"] as const) expect(validateLevelRetention(level, 1)).toBe(1);
  });

  it("the floor still respects the range: nothing above 365 and only whole days", () => {
    expect(() => validateLevelRetention("high", 400)).toThrow(ValidationError);
    expect(() => validateLevelRetention("high", 200.5)).toThrow(ValidationError);
    expect(() => validateLevelRetention("minimal", "30")).toThrow(ValidationError);
  });

  it("a level not set by the organization defaults to 30 days, or to the floor if it has one", () => {
    expect(defaultRetentionDays("minimal")).toBe(30);
    expect(defaultRetentionDays("limited")).toBe(30);
    expect(defaultRetentionDays("high")).toBe(180);
    expect(defaultRetentionDays("unclassified")).toBe(180);
  });

  it("an agent keeps its traces for the period of its level; unclassified has its own", () => {
    const days: RetentionDaysByLevel = { high: 365, limited: 90, minimal: 30, unclassified: 180 };
    expect(retentionDaysFor("high", days)).toBe(365);
    expect(retentionDaysFor("minimal", days)).toBe(30);
    expect(retentionDaysFor(null, days)).toBe(180);
  });

  it("the cutoff is exactly N days before now", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(retentionCutoff(now, 1).toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});
