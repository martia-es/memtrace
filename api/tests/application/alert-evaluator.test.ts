import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertEvaluator } from "@/application/alert-evaluator";
import type { AlertMetricSource } from "@/application/ports/alert-metric-source";
import type { AlertEmail, BudgetEmail, EmailSender } from "@/application/ports/email-sender";
import { validateAlertRule, type Sample } from "@/domain/alert";
import { FakeAlertRepository } from "../support/fake-alert-repository";

const T0 = new Date("2026-10-10T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

class Source implements AlertMetricSource {
  values: Record<string, Sample | Error> = {};
  costs: Record<string, number> = {};
  costCalls: string[] = [];
  resets = 0;
  async measure(rule: { id: string }): Promise<Sample> {
    const v = this.values[rule.id];
    if (v instanceof Error) throw v;
    return v ?? { value: null, samples: 0 };
  }
  async cost(_scope: unknown, from: Date): Promise<number> {
    const day = from.toISOString().slice(0, 10);
    this.costCalls.push(day);
    return this.costs[day] ?? 0;
  }
  reset() {
    this.resets += 1;
  }
}

class Mail implements EmailSender {
  alerts: AlertEmail[] = [];
  budgets: BudgetEmail[] = [];
  fail = false;
  sentOverride: number | null = null;
  onSend: (() => void) | null = null;
  async sendInvitationEmail() {}
  async sendReportSnapshotEmail() {}
  async sendAlertEmail(p: AlertEmail) {
    this.onSend?.();
    if (this.fail) throw new Error("provider down");
    this.alerts.push(p);
    return this.sentOverride ?? p.to.length;
  }
  async sendBudgetEmail(p: BudgetEmail) {
    this.onSend?.();
    if (this.fail) throw new Error("provider down");
    this.budgets.push(p);
    return this.sentOverride ?? p.to.length;
  }
}

let repo: FakeAlertRepository;
let source: Source;
let mail: Mail;
let clock: Date;
const evaluator = (cap?: number) => new AlertEvaluator(repo, source, mail, "https://mt.example.com/", () => clock, cap);

async function addRule(over: Record<string, unknown> = {}, experimentId = "exp1") {
  return repo.createRule(experimentId, "u1", validateAlertRule({ name: "Errors up", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: ["ops@example.com", "dev@example.com"], ...over }));
}

beforeEach(() => {
  repo = new FakeAlertRepository();
  source = new Source();
  mail = new Mail();
  clock = T0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("alert rules", () => {
  it("fires once, emails every recipient individually, and does not repeat while it stays firing", async () => {
    const rule = await addRule();
    source.values[rule.id] = { value: 9, samples: 100 };

    expect(await evaluator().run()).toMatchObject({ rules: 1, fired: 1, failed: 0 });
    expect(mail.alerts).toHaveLength(1);
    expect(mail.alerts[0]).toMatchObject({ kind: "fired", ruleName: "Errors up", experimentName: "Weather", valueText: "9 %", thresholdText: "5 %", link: "https://mt.example.com/e/exp1/alerts" });
    expect(repo.events[0]).toMatchObject({ kind: "fired", value: 9, threshold: 5, emailed: 2 });
    expect(repo.statuses.get(rule.id)).toMatchObject({ state: "firing", lastValue: 9, lastNotifiedAt: T0.toISOString() });

    clock = at(5);
    expect(await evaluator().run()).toMatchObject({ fired: 0, reminders: 0 });
    expect(mail.alerts).toHaveLength(1);
    expect(repo.events).toHaveLength(1);
  });

  it("emails again when it is back to normal", async () => {
    const rule = await addRule();
    source.values[rule.id] = { value: 9, samples: 100 };
    await evaluator().run();
    clock = at(5);
    source.values[rule.id] = { value: 1, samples: 100 };
    expect(await evaluator().run()).toMatchObject({ resolved: 1 });
    expect(mail.alerts.map((m) => m.kind)).toEqual(["fired", "resolved"]);
    expect(repo.statuses.get(rule.id)?.state).toBe("ok");
  });

  it("sends the email BEFORE saving the state: a crash in between repeats a notice, never loses one", async () => {
    const rule = await addRule();
    source.values[rule.id] = { value: 9, samples: 100 };
    mail.onSend = () => repo.log.push("email");
    await evaluator().run();
    expect(repo.log.filter((l) => l === "email" || l.startsWith("save:"))).toEqual(["email", `save:${rule.id}`]);
  });

  it("records the event even with no recipients or no email provider, with zero emails sent", async () => {
    const quiet = await addRule({ name: "Quiet", recipients: [] });
    const noProvider = await addRule({ name: "No provider" });
    source.values[quiet.id] = { value: 9, samples: 100 };
    source.values[noProvider.id] = { value: 9, samples: 100 };
    mail.sentOverride = 0; // el proveedor no está configurado: el sender devuelve 0
    await evaluator().run();
    expect(mail.alerts).toHaveLength(1); // solo la que tiene destinatarios llega a pedir un envío
    expect(repo.events.map((e) => e.emailed)).toEqual([0, 0]);
    expect(repo.events).toHaveLength(2);
  });

  it("an email provider that throws does not lose the alert or stop the other rules", async () => {
    const a = await addRule({ name: "A" });
    const b = await addRule({ name: "B" });
    source.values[a.id] = { value: 9, samples: 100 };
    source.values[b.id] = { value: 9, samples: 100 };
    mail.fail = true;
    const summary = await evaluator().run();
    expect(summary).toMatchObject({ fired: 2, failed: 0 });
    expect(repo.events.map((e) => [e.kind, e.emailed])).toEqual([["fired", 0], ["fired", 0]]);
    expect(repo.statuses.get(a.id)?.state).toBe("firing");
  });

  it("a rule whose measurement fails is reported and does not stop the rest", async () => {
    const broken = await addRule({ name: "Broken" });
    const fine = await addRule({ name: "Fine" });
    source.values[broken.id] = new Error("clickhouse down");
    source.values[fine.id] = { value: 9, samples: 100 };
    const summary = await evaluator().run();
    expect(summary).toMatchObject({ rules: 2, fired: 1, failed: 1 });
    expect(repo.statuses.has(broken.id)).toBe(false);
    expect(repo.statuses.get(fine.id)?.state).toBe("firing");
  });

  it("with too little data it neither fires nor resolves", async () => {
    const rule = await addRule();
    source.values[rule.id] = { value: 100, samples: 3 };
    await evaluator().run();
    expect(mail.alerts).toHaveLength(0);
    expect(repo.statuses.get(rule.id)?.state).toBe("no_data");

    source.values[rule.id] = { value: 9, samples: 100 };
    await evaluator().run();
    source.values[rule.id] = { value: null, samples: 0 };
    clock = at(30);
    await evaluator().run();
    expect(repo.statuses.get(rule.id)?.state).toBe("firing");
    expect(mail.alerts.map((m) => m.kind)).toEqual(["fired"]);
  });

  it("reminds after the interval and counts from the last notice, even when that notice could not be emailed", async () => {
    const rule = await addRule({ reminderMinutes: 60 });
    source.values[rule.id] = { value: 9, samples: 100 };
    await evaluator().run();
    clock = at(59);
    await evaluator().run();
    expect(mail.alerts).toHaveLength(1);
    clock = at(60);
    expect(await evaluator().run()).toMatchObject({ reminders: 1 });
    expect(mail.alerts.map((m) => m.kind)).toEqual(["fired", "reminder"]);
    clock = at(100);
    await evaluator().run();
    expect(mail.alerts).toHaveLength(2);
  });

  it("disabled rules are not evaluated", async () => {
    const rule = await addRule({ enabled: false });
    source.values[rule.id] = { value: 9, samples: 100 };
    expect(await evaluator().run()).toMatchObject({ rules: 0 });
  });

  it("clears the cache of measurements at the start of every pass", async () => {
    await evaluator().run();
    await evaluator().run();
    expect(source.resets).toBe(2);
  });

  describe("daily email cap per organization", () => {
    it("sends to as many recipients as the cap still allows and records the rest as not emailed", async () => {
      const rule = await addRule({ recipients: ["a@x.io", "b@x.io", "c@x.io"] });
      source.values[rule.id] = { value: 9, samples: 100 };
      repo.sentToday.set("org1", 98);
      await evaluator(100).run();
      expect(mail.alerts[0]!.to).toEqual(["a@x.io", "b@x.io"]);
      expect(repo.events[0]!.emailed).toBe(2);
    });

    it("sends nothing once the cap is reached, but still records the alert so the app shows it", async () => {
      const rule = await addRule();
      source.values[rule.id] = { value: 9, samples: 100 };
      repo.sentToday.set("org1", 100);
      await evaluator(100).run();
      expect(mail.alerts).toHaveLength(0);
      expect(repo.events[0]).toMatchObject({ kind: "fired", emailed: 0 });
      expect(repo.statuses.get(rule.id)?.state).toBe("firing");
    });

    it("counts per organization: another organization's quota is untouched", async () => {
      repo.experiments.set("expB", { name: "Other", serviceName: "other", organizationId: "org2" });
      const rule = await addRule({}, "expB");
      source.values[rule.id] = { value: 9, samples: 100 };
      repo.sentToday.set("org1", 100);
      await evaluator(100).run();
      expect(mail.alerts).toHaveLength(1);
    });
  });
});

describe("cost budgets", () => {
  // octubre de 2026 (31 días); «hoy» es el día 10
  const budgetOf = async (over: Record<string, unknown> = {}) =>
    repo.upsertBudget("exp1", "u1", { monthlyUsd: 100, warnPercent: 80, recipients: ["fin@example.com"], enabled: true, ...over });

  it("fills in the cost of every day of the month so far, then only today and yesterday", async () => {
    await budgetOf();
    source.costs["2026-10-10"] = 7;
    await evaluator().run();
    expect([...new Set(source.costCalls)].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`));

    source.costCalls = [];
    clock = at(5);
    await evaluator().run();
    expect([...new Set(source.costCalls)].sort()).toEqual(["2026-10-09", "2026-10-10"]);
    expect(repo.dailyCost.get("exp1")!.get("2026-10-10")).toBe(7);
  });

  it("warns once at the percentage, with the month's figures", async () => {
    await budgetOf();
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 8.5; // 85 gastados
    expect(await evaluator().run()).toMatchObject({ budgets: 1, budgetNotices: 1 });
    expect(mail.budgets).toHaveLength(1);
    expect(mail.budgets[0]).toMatchObject({ level: "warning", budgetUsd: 100, spentUsd: 85, experimentName: "Weather", link: "https://mt.example.com/e/exp1/alerts" });
    expect(mail.budgets[0]!.percent).toBeCloseTo(85);

    clock = at(5);
    await evaluator().run();
    expect(mail.budgets).toHaveLength(1);
  });

  it("goes straight to 'exceeded' when the spend jumps past 100 %, and never sends the stale warning afterwards", async () => {
    await budgetOf();
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 12; // 120
    await evaluator().run();
    expect(mail.budgets.map((m) => m.level)).toEqual(["exceeded"]);
    source.costs["2026-10-10"] = 13;
    clock = at(10);
    await evaluator().run();
    expect(mail.budgets).toHaveLength(1);
  });

  it("forecasts an overrun while still under the warning, once", async () => {
    await budgetOf();
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 6; // 60 en 10 días: ~190 a fin de mes
    await evaluator().run();
    expect(mail.budgets).toHaveLength(1);
    expect(mail.budgets[0]!.level).toBe("forecast");
    expect(mail.budgets[0]!.projectedUsd).toBeGreaterThan(100);
  });

  it("a new month starts clean", async () => {
    await budgetOf();
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 12;
    await evaluator().run();
    clock = new Date("2026-11-20T10:00:00.000Z");
    for (let d = 1; d <= 20; d++) source.costs[`2026-11-${String(d).padStart(2, "0")}`] = 6; // 120 en noviembre
    await evaluator().run();
    expect(mail.budgets.map((m) => m.level)).toEqual(["exceeded", "exceeded"]);
  });

  it("emails before marking the level as notified, and a failing provider still marks it so it is not retried every five minutes", async () => {
    await budgetOf();
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 12;
    mail.fail = true;
    await evaluator().run();
    expect(await repo.notifiedLevels("exp1", "2026-10-01")).toEqual(new Set(["exceeded", "warning", "forecast"]));
    expect(repo.notified.get("exp1|2026-10-01")!.get("exceeded")).toEqual({ emailed: 0 });
  });

  it("respects the daily cap and a budget without recipients", async () => {
    await budgetOf({ recipients: [] });
    for (let d = 1; d <= 10; d++) source.costs[`2026-10-${String(d).padStart(2, "0")}`] = 12;
    await evaluator().run();
    expect(mail.budgets).toHaveLength(0);
    expect(await repo.notifiedLevels("exp1", "2026-10-01")).toContain("exceeded");
  });

  it("a disabled budget is ignored", async () => {
    await budgetOf({ enabled: false });
    expect(await evaluator().run()).toMatchObject({ budgets: 0 });
    expect(source.costCalls).toEqual([]);
  });

  it("a budget that fails to evaluate does not stop the rules", async () => {
    await budgetOf();
    const rule = await addRule();
    source.values[rule.id] = { value: 9, samples: 100 };
    source.cost = async () => {
      throw new Error("clickhouse down");
    };
    const summary = await evaluator().run();
    expect(summary).toMatchObject({ fired: 1, failed: 1 });
  });
});
