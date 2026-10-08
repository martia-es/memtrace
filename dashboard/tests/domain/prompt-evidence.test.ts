import { describe, expect, it } from "vitest";
import type { VersionEvidenceDto } from "@contract";
import { MIN_TRACES, compareVersions, evaluatorCell, evaluatorNames, sampleQuality } from "@/domain/prompt-evidence";

const evidence = (extra: Partial<VersionEvidenceDto> = {}): VersionEvidenceDto => ({
  version: 1, traces: 100, conversations: 50, errorTraces: 10, errorRate: 0.1, latencyMs: { p50: 800, p95: 2400 }, inputTokens: 1000, outputTokens: 100,
  costUsd: 1, costPerTraceUsd: 0.01, costComplete: true, feedback: { up: 8, down: 2, ratedTraces: 10, satisfaction: 80 }, evaluators: [], errorCauses: [],
  firstSeen: "2026-10-08T10:00:00.000Z", lastSeen: "2026-10-08T11:00:00.000Z", ...extra,
});
const delta = (base: VersionEvidenceDto, target: VersionEvidenceDto, key: string) => compareVersions(base, target).deltas.find((d) => d.key === key)!;

describe("sampleQuality (ADR-069)", () => {
  it("says when there is nothing, too little or enough to conclude", () => {
    expect([sampleQuality(0), sampleQuality(MIN_TRACES - 1), sampleQuality(MIN_TRACES)]).toEqual(["none", "low", "ok"]);
  });
});

describe("compareVersions", () => {
  it("knows that fewer errors, less latency and less cost are better", () => {
    const better = evidence({ errorRate: 0.02, latencyMs: { p50: 500, p95: 1200 }, costPerTraceUsd: 0.005 });
    expect(["errorRate", "p95", "cost"].map((k) => delta(evidence(), better, k).direction)).toEqual(["better", "better", "better"]);
    const worse = evidence({ errorRate: 0.3, latencyMs: { p50: 900, p95: 5000 }, costPerTraceUsd: 0.05 });
    expect(["errorRate", "p95", "cost"].map((k) => delta(evidence(), worse, k).direction)).toEqual(["worse", "worse", "worse"]);
  });

  it("knows that more thumbs-up and higher pass rates are better", () => {
    const base = evidence({ evaluators: [{ name: "accurate", dataType: "boolean", items: 20, value: 0.6 }] });
    const target = evidence({ feedback: { up: 9, down: 1, ratedTraces: 10, satisfaction: 90 }, evaluators: [{ name: "accurate", dataType: "boolean", items: 20, value: 0.9 }] });
    expect(delta(base, target, "satisfaction").direction).toBe("better");
    expect(delta(base, target, "eval:accurate")).toMatchObject({ direction: "better", base: "60%", target: "90%", change: "+30.0 pp" });
  });

  it("ignores movements under 5 % as noise", () => {
    expect(delta(evidence(), evidence({ latencyMs: { p50: 800, p95: 2450 } }), "p95").direction).toBe("same");
    expect(delta(evidence(), evidence({ errorRate: 0.102 }), "errorRate").direction).toBe("same");
  });

  it("formats the change with its sign", () => {
    expect(delta(evidence(), evidence({ errorRate: 0.15 }), "errorRate").change).toBe("+5.0 pp");
    expect(delta(evidence(), evidence({ errorRate: 0.05 }), "errorRate").change).toBe("−5.0 pp");
    expect(delta(evidence(), evidence({ latencyMs: { p50: 800, p95: 1400 } }), "p95").change).toBe("−1.00 s");
  });

  it("does not judge a metric one of the versions does not have", () => {
    const noCost = evidence({ costPerTraceUsd: null, costUsd: null });
    expect(delta(evidence(), noCost, "cost")).toMatchObject({ direction: "unknown", change: "–", target: "–" });
    const noVotes = evidence({ feedback: { up: 0, down: 0, ratedTraces: 0, satisfaction: null } });
    expect(delta(evidence(), noVotes, "satisfaction").direction).toBe("unknown");
  });

  it("compares only the evaluators both versions have, and never categorical ones", () => {
    const base = evidence({ evaluators: [{ name: "accurate", dataType: "boolean", items: 5, value: 1 }, { name: "only-base", dataType: "numeric", items: 5, value: 3 }, { name: "topic", dataType: "categorical", items: 5, value: null }] });
    const target = evidence({ evaluators: [{ name: "accurate", dataType: "boolean", items: 5, value: 0.5 }, { name: "topic", dataType: "categorical", items: 5, value: null }] });
    expect(compareVersions(base, target).deltas.map((d) => d.key)).toEqual(["errorRate", "p95", "cost", "satisfaction", "eval:accurate"]);
    expect(delta(base, target, "eval:accurate").direction).toBe("worse");
  });

  it("is reliable only when both versions have enough traces", () => {
    expect(compareVersions(evidence(), evidence()).reliable).toBe(true);
    expect(compareVersions(evidence(), evidence({ traces: 5 })).reliable).toBe(false);
    expect(compareVersions(evidence({ traces: 29 }), evidence()).reliable).toBe(false);
  });
});

describe("evaluator columns", () => {
  const v = evidence({ evaluators: [{ name: "b", dataType: "boolean", items: 4, value: 0.75 }, { name: "n", dataType: "numeric", items: 4, value: 4.256 }, { name: "c", dataType: "categorical", items: 4, value: null }] });

  it("lists the evaluator names of all versions once, sorted", () => {
    expect(evaluatorNames([v, evidence({ evaluators: [{ name: "a", dataType: "boolean", items: 1, value: 1 }, { name: "b", dataType: "boolean", items: 1, value: 1 }] })])).toEqual(["a", "b", "c", "n"]);
  });

  it("shows each kind the way it reads best, and a dash where the version has none", () => {
    expect([evaluatorCell(v, "b"), evaluatorCell(v, "n"), evaluatorCell(v, "c"), evaluatorCell(v, "zzz")]).toEqual(["75%", "4.26", "4 items", "–"]);
  });
});
