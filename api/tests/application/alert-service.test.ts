import { describe, expect, it } from "vitest";
import { AlertService } from "@/application/alert-service";
import { AuditService } from "@/application/audit-service";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { AuditEntryInput } from "@/domain/audit";
import { AlertNotFoundError, ValidationError } from "@/domain/errors";
import { FakeAlertRepository } from "../support/fake-alert-repository";

const CHART = "11111111-1111-4111-8111-111111111111";
const OTHER_CHART = "22222222-2222-4222-8222-222222222222";
const ref = { experimentId: "exp1", organizationId: "org1" };
const actor = { userId: "u1", email: "ana@example.com" };
const body = { name: "Errors up", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: ["ops@example.com"] };

function setup(charts: Array<{ id: string; definition: Record<string, unknown> }> = []) {
  const repo = new FakeAlertRepository();
  const entries: AuditEntryInput[] = [];
  const auditRepo: AuditRepository = { append: async (e) => void entries.push(e), list: async () => ({ items: [], nextCursor: null }), purgeOlderThan: async () => 0 };
  const service = new AlertService(repo, new AuditService(auditRepo), async () => charts, () => new Date("2026-10-10T12:00:00.000Z"));
  return { repo, entries, service };
}
const ok = (over = {}) => ({ chartType: "number", stepTypes: ["guardrail"], metric: "count", metricAttribute: null, filters: [], groupByAttribute: null, ...over });
const fieldsOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return Object.keys((error as ValidationError).fields);
  }
  throw new Error("should have thrown");
};

describe("AlertService rules", () => {
  it("creates a rule and records who did it, with counts and never the email addresses", async () => {
    const { service, entries } = setup();
    const rule = await service.createRule(ref, actor, body);
    expect(rule).toMatchObject({ name: "Errors up", experimentId: "exp1" });
    expect(entries[0]).toMatchObject({ action: "alert.create", actorLabel: "ana@example.com", experimentId: "exp1", organizationId: "org1", targetId: rule.id });
    expect(entries[0]!.metadata).toEqual({ name: "Errors up", metric: "error_rate", recipients: 1 });
    expect(JSON.stringify(entries[0])).not.toContain("ops@example.com");
  });

  it("validates before touching the store", async () => {
    const { service, repo, entries } = setup();
    expect(await fieldsOf(service.createRule(ref, actor, { ...body, threshold: 500 }))).toContain("threshold");
    expect(repo.rules).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it("updating a rule resets its state, and a rule from another experiment is not found", async () => {
    const { service, repo } = setup();
    const rule = await service.createRule(ref, actor, body);
    repo.statuses.set(rule.id, { state: "firing", since: "x", lastValue: 9, lastCheckedAt: null, lastNotifiedAt: null });
    const updated = await service.updateRule(ref, actor, rule.id, { ...body, threshold: 10 });
    expect(updated.threshold).toBe(10);
    expect(repo.statuses.has(rule.id)).toBe(false);
    await expect(service.updateRule({ ...ref, experimentId: "other" }, actor, rule.id, body)).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  it("deletes, audits, and reports a rule that does not exist", async () => {
    const { service, entries } = setup();
    const rule = await service.createRule(ref, actor, body);
    await service.deleteRule(ref, actor, rule.id);
    expect(entries.map((e) => e.action)).toEqual(["alert.create", "alert.delete"]);
    await expect(service.deleteRule(ref, actor, rule.id)).rejects.toBeInstanceOf(AlertNotFoundError);
    expect(entries).toHaveLength(2);
  });

  describe("rules about a custom chart", () => {
    const custom = { ...body, metric: "custom", customMetricId: CHART, threshold: 3 };

    it("accepts a chart of this experiment with one step and no split", async () => {
      const { service } = setup([{ id: CHART, definition: ok() }]);
      expect((await service.createRule(ref, actor, custom)).customMetricId).toBe(CHART);
    });

    it("refuses a chart that does not exist here, which includes another experiment's", async () => {
      const { service } = setup([{ id: CHART, definition: ok() }]);
      expect(await fieldsOf(service.createRule(ref, actor, { ...custom, customMetricId: OTHER_CHART }))).toContain("customMetricId");
    });

    it("refuses a chart that does not produce a single number", async () => {
      const several = setup([{ id: CHART, definition: ok({ stepTypes: ["a", "b"] }) }]);
      expect(await fieldsOf(several.service.createRule(ref, actor, custom))).toContain("customMetricId");
      const split = setup([{ id: CHART, definition: ok({ groupByAttribute: "country" }) }]);
      expect(await fieldsOf(split.service.createRule(ref, actor, custom))).toContain("customMetricId");
    });

    it("does not look at charts for the other metrics", async () => {
      const { service } = setup([]);
      await expect(service.createRule(ref, actor, body)).resolves.toBeDefined();
    });
  });
});

describe("AlertService budget", () => {
  it("sets a budget and shows what is spent this month", async () => {
    const { service, repo, entries } = setup();
    await repo.upsertDailyCost("exp1", "2026-10-02", 10);
    await repo.upsertDailyCost("exp1", "2026-10-10", 30);
    await repo.upsertDailyCost("exp1", "2026-09-30", 999); // el mes anterior no cuenta
    const view = await service.setBudget(ref, actor, { monthlyUsd: 100, recipients: ["fin@example.com"] });
    expect(view).toMatchObject({ month: "2026-10-01", spentUsd: 40, percent: 40 });
    expect(view.budget).toMatchObject({ monthlyUsd: 100, warnPercent: 80, recipients: ["fin@example.com"] });
    expect(view.projectedUsd).toBeCloseTo((40 * 31) / 9.5, 4);
    expect(entries[0]).toMatchObject({ action: "budget.update", targetType: "budget" });
    expect(entries[0]!.metadata).toMatchObject({ monthlyUsd: 100, recipients: 1 });
  });

  it("validates the amount", async () => {
    expect(await fieldsOf(setup().service.setBudget(ref, actor, { monthlyUsd: -1 }))).toContain("monthlyUsd");
  });

  it("has no view without a budget, and deleting one that does not exist says so", async () => {
    const { service } = setup();
    expect(await service.budgetView("exp1")).toBeNull();
    await expect(service.deleteBudget(ref, actor)).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  it("deletes and audits", async () => {
    const { service, entries } = setup();
    await service.setBudget(ref, actor, { monthlyUsd: 50 });
    await service.deleteBudget(ref, actor);
    expect(entries.map((e) => e.action)).toEqual(["budget.update", "budget.delete"]);
    expect(await service.budgetView("exp1")).toBeNull();
  });
});

describe("AlertService overview", () => {
  it("returns the rules with their state, the recent history and the budget", async () => {
    const { service, repo } = setup();
    const rule = await service.createRule(ref, actor, body);
    await repo.recordEvaluation(rule.id, { state: "firing", since: "2026-10-10T10:00:00.000Z", lastValue: 9, lastCheckedAt: "2026-10-10T10:00:00.000Z", lastNotifiedAt: null }, { ruleId: rule.id, experimentId: "exp1", kind: "fired", value: 9, threshold: 5, emailed: 1 });
    const view = await service.overview("exp1");
    expect(view.rules).toHaveLength(1);
    expect(view.rules[0]!.status?.state).toBe("firing");
    expect(view.events).toHaveLength(1);
    expect(view.budget).toBeNull();
  });
});
