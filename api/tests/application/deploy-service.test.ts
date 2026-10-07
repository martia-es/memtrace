import { describe, expect, it } from "vitest";
import type { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { DeployGateService } from "@/application/deploy-gate-service";
import { DeployService } from "@/application/deploy-service";
import type { CiDispatcher } from "@/application/ports/ci-dispatcher";
import type { DeployRunRepository } from "@/application/ports/deploy-run-repository";
import type { DeployRun, DeployStatus, NewDeployRun } from "@/domain/deploy";
import type { GateResult } from "@/domain/deploy-gate";
import { AssistantInvariantError, AssistantNotFoundError, AssistantUpstreamError, DeployBlockedError, ValidationError } from "@/domain/errors";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const ID = "0b9a3f10-1f6c-4a7e-9b2d-5d3c1e8f7a64";
const repo = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: "deploy.yml" };
const allowed: GateResult = { allowed: true, verdict: "allowed", sha: SHA, requiredRuns: 1, runs: [], reason: "ok" };
const blocked: GateResult = { ...allowed, allowed: false, verdict: "no_evaluation", reason: "No offline evaluation was run on this commit." };

function build(opts: { gate?: GateResult; card?: object; active?: boolean; dispatchFails?: boolean } = {}) {
  const store = new Map<string, DeployRun>();
  const dispatched: unknown[] = [];
  const registry = {
    getCard: async () => ({ repo, deployments: [{ id: "dep1", deployRef: "main", environment: { key: "pro" } }], ...opts.card }),
  } as unknown as AssistantRegistryService;
  const gate = { check: async () => opts.gate ?? allowed } as unknown as DeployGateService;
  const runs: DeployRunRepository = {
    create: async (i: NewDeployRun) => {
      const run: DeployRun = { id: ID, deploymentId: i.deploymentId, experimentId: i.experimentId, commitSha: i.commitSha, ref: i.ref, requestedBy: i.requestedBy, status: "queued", gateVerdict: i.gateVerdict, gateBypassed: i.gateBypassed, bypassReason: i.bypassReason, providerRunUrl: null, error: null, createdAt: "2026-10-07T10:00:00Z", finishedAt: null };
      store.set(run.id, run);
      return run;
    },
    get: async (id) => store.get(id) ?? null,
    hasActive: async () => opts.active ?? false,
    listForDeployment: async () => [...store.values()],
    setStatus: async (id: string, status: DeployStatus, patch = {}) => {
      const run = store.get(id);
      if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return null;
      const next = { ...run, status, providerRunUrl: patch.providerRunUrl ?? run.providerRunUrl, error: patch.error ?? run.error };
      store.set(id, next);
      return next;
    },
    succeededShas: async () => [],
  };
  const dispatcher: CiDispatcher = {
    resolveRef: async () => SHA,
    dispatch: async (_r, input) => {
      if (opts.dispatchFails) throw new AssistantUpstreamError("GitHub answered 422");
      dispatched.push(input);
      return { runUrl: "https://github.com/acme/weather/actions/workflows/deploy.yml" };
    },
  };
  return { service: new DeployService(registry, gate, runs, dispatcher), store, dispatched };
}

const user = { userId: "u1", canBypass: false };

describe("DeployService (ADR-064)", () => {
  it("dispatches the workflow with the resolved commit when the gate allows it", async () => {
    const { service, dispatched } = build();
    const run = await service.deploy("e1", "dep1", user);
    expect(run).toMatchObject({ status: "running", commitSha: SHA, ref: "main", gateVerdict: "allowed", gateBypassed: false });
    expect(dispatched).toEqual([{ ref: "main", sha: SHA, environment: "pro", marker: `deploy:${ID}` }]);
  });

  it("blocks with the gate's verdict and dispatches nothing", async () => {
    const { service, dispatched, store } = build({ gate: blocked });
    const error = await service.deploy("e1", "dep1", user).catch((e) => e);
    expect(error).toBeInstanceOf(DeployBlockedError);
    expect(error.gate).toMatchObject({ verdict: "no_evaluation" });
    expect(dispatched).toEqual([]);
    expect(store.size).toBe(0);
  });

  it("lets someone with the governance permission skip the gate, with a recorded reason", async () => {
    const { service } = build({ gate: blocked });
    const run = await service.deploy("e1", "dep1", { userId: "admin", canBypass: true, bypassReason: " prod is down, hotfix " });
    expect(run).toMatchObject({ gateVerdict: "no_evaluation", gateBypassed: true, bypassReason: "prod is down, hotfix", status: "running" });
  });

  it("does not let a technical user skip it, nor skip it without a reason", async () => {
    await expect(build({ gate: blocked }).service.deploy("e1", "dep1", { ...user, bypassReason: "please" })).rejects.toBeInstanceOf(DeployBlockedError);
    await expect(build({ gate: blocked }).service.deploy("e1", "dep1", { userId: "a", canBypass: true, bypassReason: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a second deployment while one is in progress", async () => {
    await expect(build({ active: true }).service.deploy("e1", "dep1", user)).rejects.toBeInstanceOf(AssistantInvariantError);
  });

  it("explains what is missing before anything else", async () => {
    await expect(build({ card: { repo: null } }).service.deploy("e1", "dep1", user)).rejects.toThrow(/source repository/);
    await expect(build({ card: { deployments: [{ id: "dep1", deployRef: null, environment: { key: "pro" } }] } }).service.deploy("e1", "dep1", user)).rejects.toThrow(/branch or tag/);
    await expect(build().service.deploy("e1", "nope", user)).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it("records a failed deployment when the dispatch fails", async () => {
    const { service, store } = build({ dispatchFails: true });
    await expect(service.deploy("e1", "dep1", user)).rejects.toBeInstanceOf(AssistantUpstreamError);
    expect(store.get(ID)).toMatchObject({ status: "failed", error: "GitHub answered 422" });
  });

  it("previews the commit and the gate without dispatching", async () => {
    const { service, dispatched } = build({ gate: blocked });
    expect(await service.preview("e1", "dep1")).toMatchObject({ ref: "main", sha: SHA, environment: "pro", gate: { verdict: "no_evaluation" } });
    expect(dispatched).toEqual([]);
  });

  it("applies the result the webhook reports, once", async () => {
    const { service } = build();
    await service.deploy("e1", "dep1", user);
    const title = `Deploy deploy:${ID}`;
    expect(await service.applyWorkflowEvent({ title, status: "in_progress", conclusion: null, htmlUrl: "https://x/runs/1" })).toMatchObject({ status: "running", providerRunUrl: "https://x/runs/1" });
    expect(await service.applyWorkflowEvent({ title, status: "completed", conclusion: "success", htmlUrl: "https://x/runs/1" })).toMatchObject({ status: "succeeded" });
    expect(await service.applyWorkflowEvent({ title, status: "completed", conclusion: "failure", htmlUrl: null })).toBeNull(); // un final no se reabre
    expect(await service.applyWorkflowEvent({ title: "unrelated run", status: "completed", conclusion: "success", htmlUrl: null })).toBeNull();
  });
});
