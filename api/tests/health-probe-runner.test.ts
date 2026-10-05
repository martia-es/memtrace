import { describe, expect, it, vi } from "vitest";
import { AssistantRegistryService, MIN_RECHECK_SECONDS } from "@/application/assistant-registry-service";
import { runHealthProbes, shouldPrune } from "@/application/health-probe-runner";
import type { HealthProber } from "@/application/ports/health-prober";
import type { AssistantRegistryRepository } from "@/application/ports/assistant-registry-repository";
import type { Deployment, ProbeResult, ProbeTarget } from "@/domain/assistant-registry";
import { AssistantNotFoundError } from "@/domain/errors";

const ok: ProbeResult = { httpStatus: 200, latencyMs: 40, error: null };
const target = (id: string): ProbeTarget => ({ deploymentId: id, url: `https://${id}.acme.test/health`, status: "up", statusSince: null, consecutiveFailures: 0 });

function build(repo: Partial<Record<keyof AssistantRegistryRepository, unknown>>, now = new Date("2026-10-05T12:00:00Z")) {
  return new AssistantRegistryService(repo as unknown as AssistantRegistryRepository, { toolUsage: async () => [] }, () => now);
}

describe("health probe runner (ADR-053)", () => {
  it("probes every due deployment, records each result and reports only the status changes", async () => {
    const recordProbe = vi.fn(async (id: string) => (id === "d2" ? { previous: "up" as const, current: "down" as const } : { previous: "up" as const, current: "up" as const }));
    const registry = build({ listDueDeployments: async () => [target("d1"), target("d2"), target("d3")], recordProbe });
    const prober: HealthProber = { probe: vi.fn(async () => ok) };
    const summary = await runHealthProbes(registry, prober, { now: new Date("2026-10-05T12:00:00Z") });
    expect(summary).toEqual({ probed: 3, changes: [{ deploymentId: "d2", from: "up", to: "down" }], pruned: null });
    expect(prober.probe).toHaveBeenCalledWith("https://d1.acme.test/health");
    expect(recordProbe).toHaveBeenCalledTimes(3);
  });

  it("keeps going when one deployment fails to be recorded", async () => {
    const recordProbe = vi.fn(async (id: string) => {
      if (id === "d1") throw new Error("db hiccup");
      return { previous: "up" as const, current: "up" as const };
    });
    const registry = build({ listDueDeployments: async () => [target("d1"), target("d2")], recordProbe });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await runHealthProbes(registry, { probe: async () => ok });
    quiet.mockRestore();
    expect(summary.probed).toBe(2);
    expect(recordProbe).toHaveBeenCalledTimes(2);
  });

  it("never runs more probes at once than the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const prober: HealthProber = {
      probe: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return ok;
      },
    };
    const registry = build({ listDueDeployments: async () => Array.from({ length: 12 }, (_, i) => target(`d${i}`)), recordProbe: async () => null });
    await runHealthProbes(registry, prober, { concurrency: 3 });
    expect(peak).toBe(3);
  });

  it("prunes the history once a day, at 03:00 UTC", async () => {
    const pruneHealthChecks = vi.fn(async () => 42);
    const registry = build({ listDueDeployments: async () => [], pruneHealthChecks });
    expect((await runHealthProbes(registry, { probe: async () => ok }, { now: new Date("2026-10-05T03:00:30Z") })).pruned).toBe(42);
    expect((await runHealthProbes(registry, { probe: async () => ok }, { now: new Date("2026-10-05T03:01:00Z") })).pruned).toBeNull();
    expect(shouldPrune(new Date("2026-10-05T15:00:00Z"))).toBe(false);
    expect(pruneHealthChecks).toHaveBeenCalledTimes(1);
  });
});

describe("check now (ADR-053)", () => {
  const deployment = (checkedAt: string | null): Deployment =>
    ({ id: "d1", experimentId: "e1", apiUrl: "https://api.acme.test/weather/", healthUrl: null, healthCheckedAt: checkedAt }) as Deployment;

  it("probes the resolved /health URL and returns the updated deployment", async () => {
    const recordProbe = vi.fn(async () => ({ previous: "unknown", current: "up" }));
    const getDeployment = vi.fn().mockResolvedValueOnce(deployment(null)).mockResolvedValueOnce({ ...deployment("2026-10-05T12:00:00Z"), healthStatus: "up" });
    const prober: HealthProber = { probe: vi.fn(async () => ok) };
    const result = await build({ getDeployment, recordProbe }).probeNow("e1", "d1", prober);
    expect(prober.probe).toHaveBeenCalledWith("https://api.acme.test/weather/health");
    expect(recordProbe).toHaveBeenCalledTimes(1);
    expect(result.healthStatus).toBe("up");
  });

  it(`does not probe again within ${MIN_RECHECK_SECONDS} seconds`, async () => {
    const prober: HealthProber = { probe: vi.fn(async () => ok) };
    const recent = deployment("2026-10-05T11:59:55Z");
    await build({ getDeployment: async () => recent }).probeNow("e1", "d1", prober);
    expect(prober.probe).not.toHaveBeenCalled();
  });

  it("is not found for a deployment of another experiment", async () => {
    await expect(build({ getDeployment: async () => null }).probeNow("e1", "d9", { probe: async () => ok })).rejects.toBeInstanceOf(AssistantNotFoundError);
  });
});

describe("observed connections sync (ADR-053)", () => {
  it("syncs every active experiment with its own service name and keeps going when one fails", async () => {
    const seen: string[] = [];
    const registry = new AssistantRegistryService(
      {
        listActiveExperiments: async () => [
          { experimentId: "e1", serviceName: "svc-1" },
          { experimentId: "e2", serviceName: "svc-2" },
          { experimentId: "e3", serviceName: "svc-3" },
        ],
        getCard: async () => ({}) as never,
        recordObservedConnections: async (experimentId: string, observed: unknown[]) => void seen.push(`${experimentId}:${observed.length}`),
      } as unknown as AssistantRegistryRepository,
      {
        toolUsage: async (serviceName) => {
          if (serviceName === "svc-2") throw new Error("clickhouse down");
          return [{ tool: "get_weather", calls: 8, errors: 0 }, { tool: "idle", calls: 0, errors: 0 }];
        },
      },
      () => new Date("2026-10-05T12:00:00Z"),
    );
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await registry.syncAllObservedConnections();
    quiet.mockRestore();
    expect(summary).toEqual({ experiments: 3, observed: 2, failed: 1 });
    expect(seen).toEqual(["e1:1", "e3:1"]);
  });

  it("runs every 10 minutes", async () => {
    const { shouldSyncObserved } = await import("@/application/health-probe-runner");
    expect(shouldSyncObserved(new Date("2026-10-05T12:00:30Z"))).toBe(true);
    expect(shouldSyncObserved(new Date("2026-10-05T12:10:00Z"))).toBe(true);
    expect(shouldSyncObserved(new Date("2026-10-05T12:05:00Z"))).toBe(false);
  });
});
