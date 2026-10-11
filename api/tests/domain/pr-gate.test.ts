import { describe, expect, it } from "vitest";
import { evaluateDeployGate, type GateRun } from "@/domain/deploy-gate";
import { PR_CHECK_NAME, checkFromGate } from "@/domain/pr-gate";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const run = (over: Partial<GateRun> = {}): GateRun => ({
  id: "r1", name: "weather-v1", status: "completed", revision: SHA, revisionDirty: null, createdAt: "2026-10-07T10:00:00Z", itemCount: 10,
  aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 0.9, count: 10 }], ...over,
});
const check = (runs: GateRun[], extra: Parameters<typeof evaluateDeployGate>[0] extends infer T ? Partial<T> : never = {}) =>
  checkFromGate(evaluateDeployGate({ sha: SHA, runs, ...extra }), "https://memtrace.test/run");

describe("PR check from the gate (ADR-064 phase 3)", () => {
  it("passes a commit whose evaluation reaches its targets", () => {
    expect(check([run()])).toMatchObject({ name: PR_CHECK_NAME, sha: SHA, status: "completed", conclusion: "success", title: "Evaluation passed", detailsUrl: "https://memtrace.test/run" });
  });

  it("fails it and lists each evaluator under its target", () => {
    const result = check([run({ aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 0.6, count: 10 }, { name: "safety", dataType: "boolean", passRate: 0.5, count: 10 }] })]);
    expect(result).toMatchObject({ status: "completed", conclusion: "failure" });
    expect(result!.summary).toContain("- **exact_match**: 60%, target 80%");
    expect(result!.summary).toContain("- **safety**: 50%, target 80%");
  });

  it("says when an evaluator only scored part of the run", () => {
    const result = check([run({ itemCount: 26, aggregates: [{ name: "exact_match", dataType: "boolean", passRate: 1, count: 6 }] })]);
    expect(result!.conclusion).toBe("failure");
    expect(result!.summary).toContain("only 6 of 26 items were scored");
  });

  it("is in progress while the evaluation keeps uploading, with no conclusion", () => {
    const result = check([run({ status: "running" })]);
    expect(result).toMatchObject({ status: "in_progress", title: "Evaluation running" });
    expect(result).not.toHaveProperty("conclusion");
  });

  it("treats a commit that was already deployed as passing", () => {
    expect(check([], { previouslyDeployed: true })).toMatchObject({ conclusion: "success", title: "Commit already deployed" });
  });

  it("publishes nothing for a commit nobody evaluated or evaluated with uncommitted changes", () => {
    expect(check([])).toBeNull();
    expect(check([run({ revisionDirty: true })])).toBeNull();
  });
});
