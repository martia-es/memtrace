import { describe, expect, it } from "vitest";
import { AuditService } from "@/application/audit-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import type { TracePurger } from "@/application/ports/trace-purger";
import { RetentionService } from "@/application/retention-service";
import type { AuditEntryInput } from "@/domain/audit";
import { RetentionTargetNotFoundError, ValidationError } from "@/domain/errors";
import { effectiveRetentionDays, type PurgeTarget, type RetentionPolicy } from "@/domain/retention";

const actor = { userId: "u1", email: "admin@example.com" };

function fakes(initial: { defaultDays?: number; overrides?: Record<string, number | null>; targets?: PurgeTarget[] } = {}) {
  const state = { defaultDays: initial.defaultDays ?? 30, overrides: { exp1: null, exp2: null, ...(initial.overrides ?? {}) } as Record<string, number | null> };
  const audit: AuditEntryInput[] = [];
  const auditRepo: AuditRepository = {
    append: async (e) => void audit.push(e),
    list: async () => ({ items: [], nextCursor: null }),
    purgeOlderThan: async () => 0,
  };
  const repo: RetentionRepository = {
    getPolicy: async (organizationId) =>
      organizationId === "missing"
        ? null
        : ({
            organizationId,
            defaultDays: state.defaultDays,
            minDays: 1,
            maxDays: 365,
            experiments: Object.entries(state.overrides).map(([id, o]) => ({ experimentId: id, name: id, serviceName: id, overrideDays: o, effectiveDays: effectiveRetentionDays(state.defaultDays, o) })),
          } satisfies RetentionPolicy),
    effectiveDaysForService: async () => state.defaultDays,
    setOrganizationDefault: async (organizationId, days) => {
      if (organizationId === "missing") return null;
      state.defaultDays = days;
      const cleared = Object.entries(state.overrides).filter(([, o]) => o !== null && o > days).map(([id]) => id);
      for (const id of cleared) state.overrides[id] = null;
      return { clearedExperimentIds: cleared };
    },
    setExperimentOverride: async (_org, experimentId, days) => {
      if (!(experimentId in state.overrides)) return false;
      state.overrides[experimentId] = days;
      return true;
    },
    listPurgeTargets: async () => initial.targets ?? [],
  };
  const purged: { service: string; cutoff: Date }[] = [];
  const purger: TracePurger = {
    purge: async (service, cutoff) => {
      purged.push({ service, cutoff });
      if (service === "boom") throw new Error("clickhouse down");
      return { spans: service === "empty" ? 0 : 5 };
    },
  };
  return { service: new RetentionService(repo, new AuditService(auditRepo), purger), audit, purged, state };
}

describe("RetentionService", () => {
  it("shows the effective retention of each experiment", async () => {
    const { service } = fakes({ overrides: { exp1: 7 } });
    const policy = await service.getPolicy("org1");
    expect(policy.experiments.map((e) => e.effectiveDays)).toEqual([7, 30]);
  });

  it("refuses an unknown organization", async () => {
    await expect(fakes().service.getPolicy("missing")).rejects.toBeInstanceOf(RetentionTargetNotFoundError);
  });

  it("changing the organization default is audited and validated", async () => {
    const { service, audit } = fakes();
    await service.setOrganizationDefault("org1", 90, actor);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "retention.update", targetType: "organization", actorLabel: "admin@example.com", metadata: { days: 90, clearedOverrides: 0 } });
    await expect(service.setOrganizationDefault("org1", 0, actor)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.setOrganizationDefault("org1", 400, actor)).rejects.toBeInstanceOf(ValidationError);
    expect(audit).toHaveLength(1);
  });

  it("shortening the organization removes the overrides that would be longer", async () => {
    const { service, audit, state } = fakes({ defaultDays: 90, overrides: { exp1: 60, exp2: 10 } });
    await service.setOrganizationDefault("org1", 30, actor);
    expect(state.overrides).toEqual({ exp1: null, exp2: 10 });
    expect(audit[0]!.metadata).toMatchObject({ days: 30, clearedOverrides: 1 });
  });

  it("an experiment can be shorter than its organization, not longer", async () => {
    const { service, state } = fakes({ defaultDays: 30 });
    await service.setExperimentOverride("org1", "exp1", 7, actor);
    expect(state.overrides.exp1).toBe(7);
    await expect(service.setExperimentOverride("org1", "exp1", 60, actor)).rejects.toBeInstanceOf(ValidationError);
    expect(state.overrides.exp1).toBe(7);
  });

  it("null removes the override, and an experiment of another organization is not found", async () => {
    const { service, state } = fakes({ overrides: { exp1: 7 } });
    await service.setExperimentOverride("org1", "exp1", null, actor);
    expect(state.overrides.exp1).toBeNull();
    await expect(service.setExperimentOverride("org1", "other-org-exp", 7, actor)).rejects.toBeInstanceOf(RetentionTargetNotFoundError);
  });

  it("a failed audit write stops a retention change from being reported as done", async () => {
    const failing: AuditRepository = { append: async () => Promise.reject(new Error("db down")), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 };
    const base = fakes();
    const service = new RetentionService({ ...(base.service as unknown as { repo: RetentionRepository }).repo }, new AuditService(failing));
    await expect(service.setOrganizationDefault("org1", 10, actor)).rejects.toThrow("db down");
  });

  describe("purgeExpired", () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const target = (serviceName: string, days: number): PurgeTarget => ({ organizationId: "org1", experimentId: `id-${serviceName}`, serviceName, days });

    it("purges each experiment with its own cutoff and audits only when something was deleted", async () => {
      const { service, purged, audit } = fakes({ targets: [target("a", 30), target("b", 7), target("empty", 30)] });
      const summary = await service.purgeExpired(now);
      expect(summary).toEqual({ experiments: 3, spans: 10, failed: 0 });
      expect(purged.map((p) => [p.service, p.cutoff.toISOString()])).toEqual([
        ["a", "2026-09-10T00:00:00.000Z"],
        ["b", "2026-10-03T00:00:00.000Z"],
        ["empty", "2026-09-10T00:00:00.000Z"],
      ]);
      expect(audit.map((e) => e.targetId)).toEqual(["id-a", "id-b"]);
      expect(audit[0]).toMatchObject({ action: "retention.purge", actorUserId: null, actorLabel: "system:retention", metadata: { days: 30, spans: 5 } });
    });

    it("one failing experiment does not stop the others", async () => {
      const { service } = fakes({ targets: [target("boom", 30), target("ok", 30)] });
      const summary = await service.purgeExpired(now);
      expect(summary).toMatchObject({ experiments: 2, spans: 5, failed: 1 });
    });
  });
});
