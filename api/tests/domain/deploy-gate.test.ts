import { describe, expect, it } from "vitest";
import { evaluateDeployGate, judgeRun, sameRevision, validateSha, type GateRun } from "@/domain/deploy-gate";
import { ValidationError } from "@/domain/errors";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const run = (over: Partial<GateRun> = {}): GateRun => ({
  id: "r1",
  name: "weather-v1",
  status: "completed",
  revision: SHA,
  revisionDirty: null,
  createdAt: "2026-10-07T10:00:00Z",
  aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 0.9 }],
  ...over,
});

describe("deploy gate (ADR-064)", () => {
  it("allows a commit whose evaluation passes", () => {
    const result = evaluateDeployGate({ sha: SHA, runs: [run()] });
    expect(result).toMatchObject({ allowed: true, verdict: "allowed" });
  });

  it("blocks a commit nobody evaluated, ignoring runs of other commits", () => {
    const other = run({ revision: "b".repeat(40) });
    expect(evaluateDeployGate({ sha: SHA, runs: [other, run({ revision: null })] })).toMatchObject({ allowed: false, verdict: "no_evaluation" });
  });

  it("blocks while the evaluation is still running", () => {
    expect(evaluateDeployGate({ sha: SHA, runs: [run({ status: "running" })] }).verdict).toBe("evaluation_running");
  });

  it("does not accept runs made with uncommitted changes", () => {
    const result = evaluateDeployGate({ sha: SHA, runs: [run({ revisionDirty: true })] });
    expect(result).toMatchObject({ allowed: false, verdict: "only_dirty_runs" });
    // pero una limpia junto a una sucia sí cuenta
    expect(evaluateDeployGate({ sha: SHA, runs: [run({ revisionDirty: true }), run({ id: "r2" })] }).allowed).toBe(true);
  });

  it("blocks when an evaluator is under its target, and says which", () => {
    const result = evaluateDeployGate({ sha: SHA, runs: [run({ aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 0.6 }] })] });
    expect(result.verdict).toBe("failed");
    expect(result.reason).toContain("exact_match 60% (target 80%)");
    expect(result.runs[0]!.failures).toEqual([{ evaluator: "exact_match", passRate: 0.6, target: 0.8 }]);
  });

  it("uses the evaluator's own target from its score config", () => {
    const aggregates = [{ name: "safety", dataType: "boolean", passRate: 0.95 }];
    expect(evaluateDeployGate({ sha: SHA, runs: [run({ aggregates })], targets: new Map([["safety", 0.99]]) }).verdict).toBe("failed");
    expect(evaluateDeployGate({ sha: SHA, runs: [run({ aggregates })], targets: new Map([["safety", 0.9]]) }).verdict).toBe("allowed");
  });

  it("only the most recent runs count: a later failure blocks, a later pass unblocks", () => {
    const bad = run({ id: "bad", aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 0.1 }], createdAt: "2026-10-07T12:00:00Z" });
    const good = run({ id: "good", createdAt: "2026-10-07T09:00:00Z" });
    expect(evaluateDeployGate({ sha: SHA, runs: [good, bad] }).verdict).toBe("failed");
    expect(evaluateDeployGate({ sha: SHA, runs: [bad, { ...good, createdAt: "2026-10-07T13:00:00Z" }] }).verdict).toBe("allowed");
  });

  it("can require several passing runs", () => {
    const two = [run(), run({ id: "r2", createdAt: "2026-10-07T11:00:00Z" })];
    expect(evaluateDeployGate({ sha: SHA, runs: [run()], requiredRuns: 2 }).verdict).toBe("insufficient_runs");
    expect(evaluateDeployGate({ sha: SHA, runs: two, requiredRuns: 2 }).verdict).toBe("allowed");
  });

  it("a run without boolean evaluators cannot pass", () => {
    const result = evaluateDeployGate({ sha: SHA, runs: [run({ aggregates: [{ name: "len", dataType: "numeric", passRate: null }] })] });
    expect(result.verdict).toBe("failed");
    expect(result.reason).toContain("no boolean evaluator");
  });

  it("an evaluator without results fails", () => {
    expect(judgeRun(run({ aggregates: [{ name: "x", dataType: "boolean", passRate: null }] }), new Map()).passed).toBe(false);
  });

  it("lets a rollback to an already deployed commit through without evaluating", () => {
    expect(evaluateDeployGate({ sha: SHA, runs: [], previouslyDeployed: true })).toMatchObject({ allowed: true, verdict: "rollback" });
  });

  it("accepts a short SHA, and rejects things that are not a SHA", () => {
    expect(sameRevision(SHA, "3a08213")).toBe(true);
    expect(sameRevision(SHA, "3a08212")).toBe(false);
    expect(sameRevision(null, "3a08213")).toBe(false);
    expect(evaluateDeployGate({ sha: "3A08213", runs: [run()] }).allowed).toBe(true);
    expect(() => validateSha("main")).toThrow(ValidationError);
    expect(() => validateSha("abc")).toThrow(ValidationError);
  });
});
