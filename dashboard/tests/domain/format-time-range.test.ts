import { describe, expect, it } from "vitest";
import { formatCount, formatDuration, formatPercent, formatRelativeTime, shortId } from "@/domain/format";
import { DEFAULT_RANGE, isRangeKey, RANGE_PRESETS, resolveRange } from "@/domain/time-range";

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [0.25, "250 µs"],
    [3.456, "3.5 ms"],
    [120.4, "120 ms"],
    [1500, "1.50 s"],
    [45_300, "45.3 s"],
    [125_000, "2 min 5 s"],
    [Number.NaN, "–"],
  ])("%s -> %s", (ms, expected) => expect(formatDuration(ms)).toBe(expected));
});

describe("other formatters", () => {
  it("formats percentages with one decimal below 10%", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.033)).toBe("3.3%");
    expect(formatPercent(0.5)).toBe("50%");
  });
  it("uses compact notation only for large counts", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(22_800)).toBe("22.8K");
  });
  it("formats relative times", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(formatRelativeTime(ago(2), now)).toBe("just now");
    expect(formatRelativeTime(ago(30), now)).toBe("30 s ago");
    expect(formatRelativeTime(ago(300), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(7200), now)).toBe("2 h ago");
    expect(formatRelativeTime(ago(5 * 86400), now)).toBe("5 d ago");
  });
  it("shortens ids", () => expect(shortId("0123456789abcdef")).toBe("01234567"));
});

describe("time range", () => {
  it("resolves a preset relative to now", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(resolveRange("1h", now)).toEqual({ from: "2026-09-26T11:00:00.000Z", to: "2026-09-26T12:00:00.000Z" });
  });
  it("never exceeds the 30-day retention the API accepts", () => {
    const max = Math.max(...RANGE_PRESETS.map((p) => p.ms));
    expect(max).toBeLessThanOrEqual(30 * 24 * 3600_000);
  });
  it("validates keys", () => {
    expect(isRangeKey(DEFAULT_RANGE)).toBe(true);
    expect(isRangeKey("2h")).toBe(false);
  });
});

describe("shortRevision (ADR-065)", () => {
  it("shows 7 characters, or a dash when the trace has no version", async () => {
    const { shortRevision } = await import("@/domain/format");
    expect(shortRevision("3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901")).toBe("3a08213");
    expect(shortRevision(null)).toBe("–");
    expect(shortRevision(undefined)).toBe("–");
  });
});
