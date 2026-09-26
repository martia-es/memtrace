import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { extractContent, extractGenAi, remainingAttributes } from "@/domain/genai";
import { chooseBucketSeconds, fillTimeseries } from "@/domain/metrics";
import { DEFAULT_RANGE_MS, MAX_RANGE_MS, resolveTimeRange } from "@/domain/time-range";

describe("genai extraction", () => {
  it("returns null when there are no GenAI attributes", () => {
    expect(extractGenAi({ foo: "bar" })).toBeNull();
    expect(extractContent({ foo: "bar" })).toBeNull();
  });

  it("parses numbers and tolerates invalid values", () => {
    const info = extractGenAi({ "gen_ai.usage.input_tokens": "12", "gen_ai.request.temperature": "abc" })!;
    expect(info.inputTokens).toBe(12);
    expect(info.temperature).toBeNull();
  });

  it("accepts finish reasons as JSON array or plain string", () => {
    expect(extractGenAi({ "gen_ai.response.finish_reasons": '["stop","length"]' })!.finishReasons).toEqual(["stop", "length"]);
    expect(extractGenAi({ "gen_ai.response.finish_reasons": "stop" })!.finishReasons).toEqual(["stop"]);
  });

  it("returns the raw string when captured content is not JSON", () => {
    expect(extractContent({ "memtrace.input": "plain text" })).toEqual({ input: "plain text" });
  });

  it("removes consumed keys from the remaining attributes", () => {
    expect(remainingAttributes({ "memtrace.step_type": "tool", "gen_ai.tool.name": "x", custom: "1" })).toEqual({ custom: "1" });
  });
});

describe("time range", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");

  it("defaults to the last 24 hours", () => {
    expect(resolveTimeRange({}, now)).toEqual({ fromMs: now - DEFAULT_RANGE_MS, toMs: now });
  });

  it("rejects from >= to and ranges over 30 days", () => {
    expect(() => resolveTimeRange({ from: new Date(now), to: new Date(now) }, now)).toThrow(ValidationError);
    expect(() => resolveTimeRange({ from: new Date(now - MAX_RANGE_MS - 1), to: new Date(now) }, now)).toThrow(ValidationError);
    expect(() => resolveTimeRange({ from: new Date(now - MAX_RANGE_MS), to: new Date(now) }, now)).not.toThrow();
  });
});

describe("timeseries", () => {
  it("chooses ~60 buckets, multiples of 60 s, minimum 60 s", () => {
    expect(chooseBucketSeconds(0, 30 * 60_000)).toBe(60);
    expect(chooseBucketSeconds(0, 24 * 3600_000)).toBe(1440);
    expect(chooseBucketSeconds(0, 30 * 24 * 3600_000) % 60).toBe(0);
  });

  it("fills empty buckets with zeros and keeps existing points", () => {
    const point = { bucketStartMs: 120_000, traces: 3, errorTraces: 1, p95Ms: 5, totalTokens: 7 };
    const filled = fillTimeseries([point], 0, 240_000, 60);
    expect(filled.map((p) => p.bucketStartMs)).toEqual([0, 60_000, 120_000, 180_000]);
    expect(filled[2]).toEqual(point);
    expect(filled[0]!.traces).toBe(0);
  });
});
