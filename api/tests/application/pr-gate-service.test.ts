import { describe, expect, it, vi } from "vitest";
import { PrGateService } from "@/application/pr-gate-service";
import type { RepoConfig } from "@/domain/assistant-registry";
import type { GateResult } from "@/domain/deploy-gate";
import type { CheckPayload } from "@/domain/pr-gate";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const github: RepoConfig = { url: "https://github.com/acme/weather", provider: "github", deployWorkflow: "deploy.yml", prGate: true };
const passed: GateResult = { allowed: true, verdict: "allowed", sha: SHA, requiredRuns: 1, runs: [], reason: "All evaluators reached their targets" };
const run = { id: "run-1", datasetId: "ds-1", revision: SHA, revisionDirty: null as boolean | null };

function setup(over: { repo?: RepoConfig | null; gate?: () => Promise<GateResult>; publish?: () => Promise<void> } = {}) {
  const published: CheckPayload[] = [];
  const publishCheck = vi.fn(async (_repo: RepoConfig, check: CheckPayload) => { published.push(check); await over.publish?.(); });
  const gate = { check: vi.fn(over.gate ?? (async () => passed)) };
  const registry = { getCard: vi.fn(async () => ({ repo: over.repo === undefined ? github : over.repo }) as never) };
  return { service: new PrGateService(registry, gate, { publishCheck }, "https://memtrace.test/"), published, gate, publishCheck };
}

describe("PrGateService (ADR-064 phase 3)", () => {
  it("publishes the verdict of the evaluated commit, linking to the run", async () => {
    const { service, published, gate } = setup();
    expect(await service.onRunChanged("exp-1", run)).toBe(true);
    expect(gate.check).toHaveBeenCalledWith("exp-1", SHA);
    expect(published[0]).toMatchObject({ sha: SHA, conclusion: "success", detailsUrl: "https://memtrace.test/experiments/exp-1/datasets/ds-1/runs/run-1" });
  });

  it.each([
    ["the agent did not turn the gate on", { repo: { ...github, prGate: false } }],
    ["the agent has no repository", { repo: null }],
    ["the repository is not on GitHub", { repo: { ...github, provider: "gitlab" as const } }],
  ])("does nothing when %s", async (_why, over) => {
    const { service, publishCheck, gate } = setup(over);
    expect(await service.onRunChanged("exp-1", run)).toBe(false);
    expect(publishCheck).not.toHaveBeenCalled();
    expect(gate.check).not.toHaveBeenCalled();
  });

  it("ignores runs with no commit or made with uncommitted changes", async () => {
    const { service, publishCheck } = setup();
    expect(await service.onRunChanged("exp-1", { ...run, revision: null })).toBe(false);
    expect(await service.onRunChanged("exp-1", { ...run, revisionDirty: true })).toBe(false);
    expect(publishCheck).not.toHaveBeenCalled();
  });

  it("never throws: a GitHub or gate failure only means no check", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await setup({ publish: async () => { throw new Error("GitHub answered 403"); } }).service.onRunChanged("exp-1", run)).toBe(false);
      expect(await setup({ gate: async () => { throw new Error("db down"); } }).service.onRunChanged("exp-1", run)).toBe(false);
      expect(quiet).toHaveBeenCalledTimes(2);
    } finally { quiet.mockRestore(); }
  });
});
