import { describe, expect, it, vi } from "vitest";
import { TraceAlertMetricSource } from "@/application/alert-metric-source";
import { validateAlertRule, type AlertRule } from "@/domain/alert";

const SCOPE = { experimentId: "exp1", serviceName: "weather" };
const NOW = new Date("2026-10-25T12:07:42.500Z");

const rule = (over: Record<string, unknown>): AlertRule => ({
  ...validateAlertRule({ name: "r", recipients: [], threshold: 5, windowMinutes: 15, ...over }),
  id: "r1", experimentId: "exp1", createdAt: "", updatedAt: "",
});
const bool = (name: string, ok: boolean) => ({ name, value: String(ok), dataType: "boolean", source: "code", comment: null });
const result = (...checks: boolean[]) => ({ itemIndex: 0, traceId: null, input: null, output: null, error: null, scores: checks.map((c, i) => bool(`c${i}`, c)) });
const run = (id: string, createdAt: string, over: Record<string, unknown> = {}) =>
  ({ id, datasetId: "ds1", datasetName: "attacks", name: "redteam/demo", status: "completed", createdAt, versionMajor: 1, versionMinor: 0, ...over });

function setup(runs: ReturnType<typeof run>[], results: Record<string, unknown[]> = {}, count = 7) {
  const countInWindow = vi.fn(async () => count);
  const listRunsForExperiment = vi.fn(async () => runs);
  const listScoresByRun = vi.fn(async (_s: unknown, id: string) => results[id] ?? []);
  const source = new TraceAlertMetricSource({} as never, {} as never, async () => null, { security: { countInWindow }, runs: { listRunsForExperiment }, scores: { listScoresByRun } } as never);
  return { source, countInWindow, listScoresByRun };
}

describe("security rules", () => {
  it("count the detections of the window with the detector and severity filters", async () => {
    const { source, countInWindow } = setup([]);
    const r = rule({ metric: "security_detections", params: { detector: "secret_leak", severity: "high" } });
    expect(await source.measure(r, SCOPE, NOW)).toEqual({ value: 7, samples: 0 });
    expect(countInWindow).toHaveBeenCalledWith({ scope: SCOPE, fromMs: Date.parse("2026-10-25T11:52:00Z"), toMs: Date.parse("2026-10-25T12:07:00Z"), detector: "secret_leak", severity: "high", blockedOnly: false });
  });

  it("blocked calls ask only for the ones that cut the execution", async () => {
    const { source, countInWindow } = setup([]);
    await source.measure(rule({ metric: "security_blocked" }), SCOPE, NOW);
    expect(countInWindow).toHaveBeenCalledWith(expect.objectContaining({ blockedOnly: true, detector: null }));
  });
});

describe("evaluation rules", () => {
  const drop = { metric: "eval_score", params: { target: "redteam/", score: "", mode: "drop" } };

  it("absolute: the score of the latest completed matching run, with its evaluated items", async () => {
    const runs = [run("old", "2026-10-01T00:00:00Z"), run("new", "2026-10-20T00:00:00Z"), run("running", "2026-10-24T00:00:00Z", { status: "running" }), run("other", "2026-10-24T00:00:00Z", { name: "nightly", datasetName: "weather" })];
    const { source } = setup(runs, { new: [result(true), result(true), result(false), result(true)], old: [result(true)] });
    expect(await source.measure(rule({ metric: "eval_score", params: { target: "redteam/", mode: "absolute" } }), SCOPE, NOW)).toEqual({ value: 75, samples: 4 });
  });

  it("drop: previous score minus latest score, in points, against the previous run of the same dataset version", async () => {
    const runs = [run("new", "2026-10-20T00:00:00Z"), run("v2", "2026-10-15T00:00:00Z", { versionMajor: 2 }), run("prev", "2026-10-10T00:00:00Z")];
    const { source } = setup(runs, { new: [result(true), result(false)], prev: [result(true), result(true), result(true), result(false)] });
    expect(await source.measure(rule(drop), SCOPE, NOW)).toEqual({ value: 25, samples: 2 });
  });

  it("drop has no value without a previous comparable run", async () => {
    const { source } = setup([run("only", "2026-10-20T00:00:00Z")], { only: [result(true)] });
    expect(await source.measure(rule(drop), SCOPE, NOW)).toEqual({ value: null, samples: 0 });
  });

  it("no matching run means no value, not zero", async () => {
    const { source } = setup([]);
    expect(await source.measure(rule(drop), SCOPE, NOW)).toEqual({ value: null, samples: 0 });
  });

  it("'no recent run' measures the days since the latest completed matching run", async () => {
    const { source } = setup([run("a", "2026-10-22T12:07:42.500Z"), run("b", "2026-10-01T00:00:00Z")]);
    expect(await source.measure(rule({ metric: "eval_stale", threshold: 14, params: { target: "redteam/" } }), SCOPE, NOW)).toEqual({ value: 3, samples: 0 });
  });
});
