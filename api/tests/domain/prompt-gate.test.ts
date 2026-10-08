import { describe, expect, it } from "vitest";
import type { GateRun } from "@/domain/deploy-gate";
import { ValidationError } from "@/domain/errors";
import { evaluatePromptGate, gatedEnvironments, validateRequiredRuns, type PromptPolicy } from "@/domain/prompt-gate";

const policy = (extra: Partial<PromptPolicy> = {}): PromptPolicy => ({ promptId: "p1", datasetId: "d1", requiredRuns: 1, updatedBy: "u1", updatedAt: "t", ...extra });
const run = (id: string, passRate: number | null, extra: Partial<GateRun> = {}): GateRun => ({
  id, name: `run ${id}`, status: "completed", revision: null, revisionDirty: null, createdAt: `2026-10-0${id}T10:00:00.000Z`, itemCount: 10,
  aggregates: [{ name: "accurate", dataType: "boolean", passRate, count: 10 }], ...extra,
});
const gate = (extra: Partial<Parameters<typeof evaluatePromptGate>[0]> = {}) =>
  evaluatePromptGate({ tag: "pro", version: 3, gated: ["pre", "pro"], policy: policy(), previouslyServed: false, runs: [], ...extra });

describe("gatedEnvironments (ADR-070)", () => {
  it("protects every environment except the first by position, where one iterates freely", () => {
    expect(gatedEnvironments(["dev", "pre", "pro"])).toEqual(["pre", "pro"]);
    expect(gatedEnvironments(["dev"])).toEqual([]);
    expect(gatedEnvironments(["sandbox", "staging", "canary", "prod"])).toEqual(["staging", "canary", "prod"]);
  });
});

describe("validateRequiredRuns", () => {
  it("accepts whole numbers from 1 to 10", () => {
    expect([1, 3, 10].map(validateRequiredRuns)).toEqual([1, 3, 10]);
  });

  it.each([0, 11, 1.5, -1, "2", null])("rejects %j", (value) => {
    expect(() => validateRequiredRuns(value)).toThrow(ValidationError);
  });
});

describe("evaluatePromptGate", () => {
  it("does not gate an environment that is not protected, with or without a policy", () => {
    expect(gate({ tag: "dev" })).toMatchObject({ allowed: true, verdict: "not_gated" });
    expect(gate({ tag: "dev", policy: null })).toMatchObject({ allowed: true, verdict: "not_gated" });
    expect(gate({ tag: "stable" })).toMatchObject({ allowed: true, verdict: "not_gated" }); // a free tag is not an environment
  });

  it("lets anything through when the prompt has no policy", () => {
    expect(gate({ policy: null })).toMatchObject({ allowed: true, verdict: "no_policy" });
  });

  it("lets a version go back to where it already was without evaluating it again", () => {
    expect(gate({ previouslyServed: true })).toMatchObject({ allowed: true, verdict: "rollback" });
  });

  it("blocks when the policy lost its dataset instead of opening by itself", () => {
    const blocked = gate({ policy: policy({ datasetId: null }) });
    expect(blocked).toMatchObject({ allowed: false, verdict: "policy_incomplete" });
    expect(blocked.reason).toContain("no longer exists");
  });

  it("blocks a version nobody evaluated, naming it", () => {
    const blocked = gate();
    expect(blocked).toMatchObject({ allowed: false, verdict: "no_evaluation" });
    expect(blocked.reason).toContain("v3");
  });

  it("waits for an evaluation that is still uploading", () => {
    expect(gate({ runs: [run("1", 1, { status: "running" })] })).toMatchObject({ allowed: false, verdict: "evaluation_running" });
  });

  it("allows a version whose evaluation passes every boolean evaluator", () => {
    const allowed = gate({ runs: [run("1", 0.9)] });
    expect(allowed).toMatchObject({ allowed: true, verdict: "allowed", requiredRuns: 1 });
    expect(allowed.runs).toHaveLength(1);
  });

  it("blocks and explains which evaluator is below its target (80 % unless its score config says otherwise)", () => {
    const blocked = gate({ runs: [run("1", 0.7)] });
    expect(blocked).toMatchObject({ allowed: false, verdict: "failed" });
    expect(blocked.reason).toContain("accurate 70% (target 80%)");
    expect(gate({ runs: [run("1", 0.7)], targets: new Map([["accurate", 0.6]]) }).allowed).toBe(true);
  });

  it("does not trust a pass rate computed on a fraction of the items", () => {
    const blocked = gate({ runs: [run("1", 1, { aggregates: [{ name: "accurate", dataType: "boolean", passRate: 1, count: 6 }] })] });
    expect(blocked).toMatchObject({ allowed: false, verdict: "failed" });
    expect(blocked.reason).toContain("scored only 6 of 10");
  });

  it("needs as many passing runs in a row as the policy says, newest first", () => {
    const policy3 = policy({ requiredRuns: 3 });
    expect(gate({ policy: policy3, runs: [run("1", 0.9), run("2", 0.9)] })).toMatchObject({ allowed: false, verdict: "insufficient_runs" });
    expect(gate({ policy: policy3, runs: [run("1", 0.9), run("2", 0.9), run("3", 0.9)] })).toMatchObject({ allowed: true, verdict: "allowed" });
    // the newest run fails: older passes do not save it
    expect(gate({ policy: policy3, runs: [run("1", 0.9), run("2", 0.9), run("3", 0.4)] })).toMatchObject({ allowed: false, verdict: "failed" });
  });

  it("a later pass unblocks an earlier failure", () => {
    expect(gate({ runs: [run("1", 0.4), run("2", 0.95)] }).allowed).toBe(true);
  });

  it("cannot judge an evaluation with no boolean evaluator", () => {
    const blocked = gate({ runs: [run("1", null, { aggregates: [{ name: "tone", dataType: "numeric", passRate: null, count: 10 }] })] });
    expect(blocked).toMatchObject({ allowed: false, verdict: "failed" });
    expect(blocked.reason).toContain("no boolean evaluator");
  });
});
