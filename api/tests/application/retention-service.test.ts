import { describe, expect, it } from "vitest";
import { AuditService } from "@/application/audit-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import type { TracePurger } from "@/application/ports/trace-purger";
import { RetentionService } from "@/application/retention-service";
import type { AuditEntryInput } from "@/domain/audit";
import { RetentionConfirmationRequiredError, RetentionTargetNotFoundError, ValidationError } from "@/domain/errors";
import { RETENTION_LEVELS, minRetentionDays, retentionDaysFor, retentionLevelOf, type PurgeTarget, type RetentionDaysByLevel, type RetentionPolicy } from "@/domain/retention";
import type { RiskLevel } from "@/domain/risk";
import type { TraceCounter } from "@/application/ports/trace-counter";

const actor = { userId: "u1", email: "admin@example.com" };

type Agent = { id: string; level: RiskLevel | null };

function fakes(initial: { days?: Partial<RetentionDaysByLevel>; agents?: Agent[]; targets?: PurgeTarget[]; counted?: number } = {}) {
  const state = {
    days: { high: 365, limited: 90, minimal: 30, unclassified: 180, ...(initial.days ?? {}) } as RetentionDaysByLevel,
    agents: initial.agents ?? [{ id: "exp1", level: "minimal" as RiskLevel | null }, { id: "exp2", level: null as RiskLevel | null }],
  };
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
            minDays: 1,
            maxDays: 365,
            aiActFloorDays: 180,
            levels: RETENTION_LEVELS.map((level) => ({ level, days: state.days[level], minDays: minRetentionDays(level), agents: state.agents.filter((a) => retentionLevelOf(a.level) === level).length })),
            agents: state.agents.map((a) => ({ experimentId: a.id, name: a.id, serviceName: a.id, level: a.level, effectiveDays: retentionDaysFor(a.level, state.days), intendedPurpose: "", classifiedBy: null, classifiedAt: null })),
          } satisfies RetentionPolicy),
    effectiveDaysForService: async () => state.days.minimal,
    setLevelDays: async (organizationId, level, days) => {
      if (organizationId === "missing") return false;
      state.days[level] = days;
      return true;
    },
    listPurgeTargets: async () => initial.targets ?? [],
  };
  const purged: { service: string; experimentId: string; cutoff: Date }[] = [];
  const purger: TracePurger = {
    purge: async ({ serviceName: service, experimentId }, cutoff) => {
      purged.push({ service, experimentId, cutoff });
      if (service === "boom") throw new Error("clickhouse down");
      return { spans: service === "empty" ? 0 : 5 };
    },
  };
  const counted: { experimentId: string; cutoff: Date }[] = [];
  const counter: TraceCounter = {
    countOlderThan: async ({ experimentId }, cutoff) => {
      counted.push({ experimentId, cutoff });
      return initial.counted ?? 100;
    },
  };
  return { service: new RetentionService(repo, new AuditService(auditRepo), purger, counter), audit, purged, counted, state, repo };
}

describe("RetentionService (ADR-102)", () => {
  it("shows the period of each level and the one each agent gets from its level", async () => {
    const { service } = fakes();
    const policy = await service.getPolicy("org1");
    expect(policy.levels.map((l) => [l.level, l.days, l.agents])).toEqual([["high", 365, 0], ["limited", 90, 0], ["minimal", 30, 1], ["unclassified", 180, 1]]);
    expect(policy.agents.map((a) => a.effectiveDays)).toEqual([30, 180]);
  });

  it("refuses an unknown organization", async () => {
    await expect(fakes().service.getPolicy("missing")).rejects.toBeInstanceOf(RetentionTargetNotFoundError);
  });

  it("changing a level is audited with the old and the new period", async () => {
    const { service, audit, state } = fakes();
    await service.setLevelDays("org1", "limited", 120, actor);
    expect(state.days.limited).toBe(120);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "retention.update", targetType: "risk_level", targetId: "limited", actorLabel: "admin@example.com", metadata: { level: "limited", days: 120, previousDays: 90 } });
  });

  it("never lets high or unclassified go below the AI Act floor, and does not audit the attempt", async () => {
    const { service, audit, state } = fakes();
    await expect(service.setLevelDays("org1", "high", 179, actor)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.setLevelDays("org1", "unclassified", 30, actor, true)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.setLevelDays("org1", "minimal", 400, actor)).rejects.toBeInstanceOf(ValidationError);
    expect(state.days).toMatchObject({ high: 365, unclassified: 180, minimal: 30 });
    expect(audit).toHaveLength(0);
  });

  it("lowering a level with agents asks for confirmation and says what would be lost", async () => {
    const { service, audit, state, counted } = fakes({ counted: 1200 });
    const error = await service.setLevelDays("org1", "minimal", 10, actor).catch((e) => e);
    expect(error).toBeInstanceOf(RetentionConfirmationRequiredError);
    expect(error.preview).toEqual({ level: "minimal", previousDays: 30, days: 10, lowering: true, agents: 1, spans: 1200 });
    expect(counted.map((c) => c.experimentId)).toEqual(["exp1"]);
    expect(state.days.minimal).toBe(30);
    expect(audit).toHaveLength(0);

    await service.setLevelDays("org1", "minimal", 10, actor, true);
    expect(state.days.minimal).toBe(10);
    expect(audit[0]!.metadata).toMatchObject({ days: 10, previousDays: 30, agents: 1 });
  });

  it("lowering a level nobody is in, or raising one, needs no confirmation", async () => {
    const { service, state } = fakes();
    await service.setLevelDays("org1", "limited", 10, actor);
    await service.setLevelDays("org1", "minimal", 60, actor);
    expect(state.days).toMatchObject({ limited: 10, minimal: 60 });
    const preview = await service.previewLevelChange("org1", "minimal", 90);
    expect(preview).toMatchObject({ lowering: false, agents: 0, spans: 0 });
  });

  it("a preview that cannot count spans still says how many agents are affected", async () => {
    const base = fakes();
    const failing: TraceCounter = { countOlderThan: async () => Promise.reject(new Error("clickhouse down")) };
    const service = new RetentionService(base.repo, new AuditService({ append: async () => undefined, list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 }), undefined, failing);
    expect(await service.previewLevelChange("org1", "minimal", 5)).toMatchObject({ lowering: true, agents: 1, spans: null });
  });

  it("an unknown organization is not found", async () => {
    await expect(fakes().service.setLevelDays("missing", "limited", 10, actor)).rejects.toBeInstanceOf(RetentionTargetNotFoundError);
  });

  it("a failed audit write stops a retention change from being reported as done", async () => {
    const failing: AuditRepository = { append: async () => Promise.reject(new Error("db down")), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 };
    const base = fakes();
    const service = new RetentionService(base.repo, new AuditService(failing));
    await expect(service.setLevelDays("org1", "limited", 100, actor)).rejects.toThrow("db down");
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
