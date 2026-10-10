/**
 * Contra un Postgres real (15+) con las migraciones 001-044 aplicadas. Opt-in: `POSTGRES_INTEGRATION_URL=postgres://… npm run test:integration`.
 * Cubre lo que los fakes no pueden: las restricciones de las migraciones 042 y 044, las cascadas, las consultas del evaluador y el tope diario
 * contado en la base de datos (ADR-086).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAlertRepository } from "@/adapters/outbound/postgres/postgres-alert-repository";
import { PostgresIdentityRepository } from "@/adapters/outbound/postgres/postgres-identity-repository";
import { AlertEvaluator } from "@/application/alert-evaluator";
import type { AlertMetricSource } from "@/application/ports/alert-metric-source";
import type { EmailSender } from "@/application/ports/email-sender";
import { validateAlertRule, type AlertStatus, type Sample } from "@/domain/alert";

const url = process.env.POSTGRES_INTEGRATION_URL;

describe.skipIf(!url)("alerts and budgets (postgres)", () => {
  let pool: Pool;
  let repo: PostgresAlertRepository;
  let orgId: string;
  let otherOrgId: string;
  let expA: string;
  let expB: string;
  let expOther: string;
  let userId: string;
  const stamp = Date.now();
  const input = (over: Record<string, unknown> = {}) =>
    validateAlertRule({ name: "Errors up", metric: "error_rate", comparator: "above", threshold: 5, windowMinutes: 15, recipients: ["ops@example.com"], ...over });
  const status = (state: AlertStatus["state"], over: Partial<AlertStatus> = {}): AlertStatus => ({ state, since: "2026-10-10T10:00:00.000Z", lastValue: 9, lastCheckedAt: "2026-10-10T10:00:00.000Z", lastNotifiedAt: null, ...over });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const identity = new PostgresIdentityRepository(pool);
    repo = new PostgresAlertRepository(pool);
    userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Owner') RETURNING id`, [`alerts-${stamp}@example.com`])).rows[0]!.id;
    orgId = (await identity.createOrganization(`alerts-org-${stamp}`, userId)).id;
    otherOrgId = (await identity.createOrganization(`alerts-other-${stamp}`, userId)).id;
    expA = (await identity.createExperiment(orgId, "a", `alerts-a-${stamp}`)).id;
    expB = (await identity.createExperiment(orgId, "b", `alerts-b-${stamp}`)).id;
    expOther = (await identity.createExperiment(otherOrgId, "other", `alerts-o-${stamp}`)).id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [`alerts-${stamp}@example.com`]);
    await pool.end();
  });

  it("seeds the permission: only technical manages alerts", async () => {
    const { rows } = await pool.query<{ role_name: string }>(`SELECT role_name FROM role_permissions WHERE permission = 'alert:manage'`);
    expect(rows.map((r) => r.role_name)).toEqual(["technical"]);
  });

  describe("rules", () => {
    it("creates, lists with their state and finds a rule only inside its experiment", async () => {
      const rule = await repo.createRule(expA, userId, input({ recipients: ["a@x.io", "b@x.io"], reminderMinutes: 60 }));
      expect(rule).toMatchObject({ name: "Errors up", metric: "error_rate", threshold: 5, windowMinutes: 15, minSamples: 20, reminderMinutes: 60, recipients: ["a@x.io", "b@x.io"], enabled: true });
      expect((await repo.listRules(expA)).map((r) => [r.rule.id, r.status])).toEqual([[rule.id, null]]);
      expect(await repo.getRule(expA, rule.id)).toMatchObject({ id: rule.id });
      expect(await repo.getRule(expB, rule.id)).toBeNull();
      expect(await repo.getRule("not-a-uuid", rule.id)).toBeNull();
      expect(await repo.listRules("not-a-uuid")).toEqual([]);
    });

    it("the database itself refuses what the application should already have refused", async () => {
      const raw = (sql: string, params: unknown[]) => pool.query(sql, params);
      const base = [expA, "x", "error_rate", null, "above", 5, 15, 20, null, ["a@x.io"], true];
      const insert = `INSERT INTO alert_rules (experiment_id, name, metric, custom_metric_id, comparator, threshold, window_minutes, min_samples, reminder_minutes, recipients, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
      const with_ = (i: number, v: unknown) => base.map((b, j) => (j === i ? v : b));
      await expect(raw(insert, with_(1, "   "))).rejects.toThrow(); // nombre vacío
      await expect(raw(insert, with_(2, "memory"))).rejects.toThrow(); // métrica desconocida
      await expect(raw(insert, with_(4, "equal"))).rejects.toThrow(); // comparador desconocido
      await expect(raw(insert, with_(6, 4))).rejects.toThrow(); // ventana < 5
      await expect(raw(insert, with_(6, 1441))).rejects.toThrow(); // ventana > 1 día
      await expect(raw(insert, with_(8, 14))).rejects.toThrow(); // recordatorio < 15
      await expect(raw(insert, with_(9, Array.from({ length: 11 }, (_, i) => `p${i}@x.io`)))).rejects.toThrow(); // más de 10 destinatarios
      await expect(raw(insert, with_(3, "11111111-1111-4111-8111-111111111111"))).rejects.toThrow(); // gráfica en una regla que no es custom
    });

    it("updating a rule resets its state, and one from another experiment is untouched", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "To change" }));
      await repo.recordEvaluation(rule.id, status("firing"), null);
      const updated = await repo.updateRule(expA, rule.id, input({ name: "Changed", threshold: 10, enabled: false }));
      expect(updated).toMatchObject({ name: "Changed", threshold: 10, enabled: false });
      expect((await repo.listRules(expA)).find((r) => r.rule.id === rule.id)!.status).toBeNull();
      expect(await repo.updateRule(expB, rule.id, input())).toBeNull();
      expect((await repo.getRule(expA, rule.id))!.name).toBe("Changed");
    });

    it("deleting a rule removes its state and history", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "To delete" }));
      await repo.recordEvaluation(rule.id, status("firing"), { ruleId: rule.id, experimentId: expA, kind: "fired", value: 9, threshold: 5, emailed: 1 });
      expect(await repo.deleteRule(expB, rule.id)).toBe(false);
      expect(await repo.deleteRule(expA, rule.id)).toBe(true);
      expect((await pool.query(`SELECT 1 FROM alert_states WHERE rule_id = $1`, [rule.id])).rowCount).toBe(0);
      expect((await pool.query(`SELECT 1 FROM alert_events WHERE rule_id = $1`, [rule.id])).rowCount).toBe(0);
      expect(await repo.deleteRule(expA, rule.id)).toBe(false);
    });

    it("a custom rule keeps existing, without a chart, when its chart is deleted", async () => {
      const chart = (await pool.query<{ id: string }>(`INSERT INTO custom_metrics (experiment_id, created_by, name, definition) VALUES ($1, $2, 'c', '{}'::jsonb) RETURNING id`, [expA, userId])).rows[0]!.id;
      const rule = await repo.createRule(expA, userId, input({ name: "Custom", metric: "custom", customMetricId: chart, threshold: 3 }));
      await pool.query(`DELETE FROM custom_metrics WHERE id = $1`, [chart]);
      const found = await repo.getRule(expA, rule.id);
      expect(found).not.toBeNull();
      expect(found!.customMetricId).toBeNull();
    });
  });

  describe("state and history", () => {
    it("saves the state and its event together, and pages the history newest first", async () => {
      const rule = await repo.createRule(expB, userId, input({ name: "History" }));
      for (const kind of ["fired", "reminder", "resolved"] as const) {
        await repo.recordEvaluation(rule.id, status(kind === "resolved" ? "ok" : "firing"), { ruleId: rule.id, experimentId: expB, kind, value: 9, threshold: 5, emailed: 2 });
      }
      const first = await repo.listEvents(expB, 2);
      expect(first.items.map((e) => e.kind)).toEqual(["resolved", "reminder"]);
      expect(first.nextCursor).not.toBeNull();
      const next = await repo.listEvents(expB, 2, first.nextCursor!);
      expect(next.items.map((e) => e.kind)).toEqual(["fired"]);
      expect(next.nextCursor).toBeNull();
      expect((await repo.listRules(expB)).find((r) => r.rule.id === rule.id)!.status).toMatchObject({ state: "ok", lastValue: 9 });
      expect((await repo.listEvents(expA, 50)).items.every((e) => e.experimentId === expA)).toBe(true);
    });

    it("rewrites the state in place on every evaluation", async () => {
      const rule = await repo.createRule(expB, userId, input({ name: "Rewrite" }));
      await repo.recordEvaluation(rule.id, status("firing", { lastValue: 9 }), null);
      await repo.recordEvaluation(rule.id, status("ok", { lastValue: 1 }), null);
      expect((await pool.query(`SELECT count(*)::int AS n FROM alert_states WHERE rule_id = $1`, [rule.id])).rows[0].n).toBe(1);
      expect((await repo.listRules(expB)).find((r) => r.rule.id === rule.id)!.status).toMatchObject({ state: "ok", lastValue: 1 });
    });

    it("lists as open only the enabled rules that are firing, and only in the experiments asked for", async () => {
      const open = await repo.createRule(expB, userId, input({ name: "Open one" }));
      const fine = await repo.createRule(expB, userId, input({ name: "Fine one" }));
      const off = await repo.createRule(expB, userId, input({ name: "Disabled one", enabled: false }));
      const elsewhere = await repo.createRule(expOther, userId, input({ name: "Elsewhere" }));
      await repo.recordEvaluation(open.id, status("firing"), null);
      await repo.recordEvaluation(fine.id, status("ok"), null);
      await repo.recordEvaluation(off.id, status("firing"), null);
      await repo.recordEvaluation(elsewhere.id, status("firing"), null);
      const names = (await repo.listOpen([expB])).map((a) => a.ruleName);
      expect(names).toContain("Open one");
      expect(names).not.toContain("Fine one");
      expect(names).not.toContain("Disabled one");
      expect(names).not.toContain("Elsewhere");
      expect((await repo.listOpen([expB, expOther])).map((a) => a.ruleName)).toContain("Elsewhere");
      expect(await repo.listOpen([])).toEqual([]);
      expect(await repo.listOpen(["not-a-uuid"])).toEqual([]);
      expect((await repo.listOpen([expB])).find((a) => a.ruleName === "Open one")).toMatchObject({ experimentName: "b", metric: "error_rate", threshold: 5, comparator: "above" });
    });

    it("builds the bell feed from fired and resolved events and budget notices, newest first, without reminders", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "Feed rule" }));
      const hidden = await repo.createRule(expOther, userId, input({ name: "Feed elsewhere" }));
      await repo.recordEvaluation(rule.id, status("firing"), { ruleId: rule.id, experimentId: expA, kind: "fired", value: 9, threshold: 5, emailed: 1 });
      await repo.recordEvaluation(rule.id, status("firing"), { ruleId: rule.id, experimentId: expA, kind: "reminder", value: 9, threshold: 5, emailed: 1 });
      await repo.recordEvaluation(rule.id, status("ok", { lastValue: 1 }), { ruleId: rule.id, experimentId: expA, kind: "resolved", value: 1, threshold: 5, emailed: 1 });
      await repo.recordEvaluation(hidden.id, status("firing"), { ruleId: hidden.id, experimentId: expOther, kind: "fired", value: 9, threshold: 5, emailed: 0 });
      await repo.upsertBudget(expA, userId, { monthlyUsd: 50, warnPercent: 80, recipients: [], enabled: true });
      await repo.markBudgetNotified(expA, "2026-10-01", ["warning", "exceeded"], "exceeded", 0); // se saltó de nivel: solo se enseña el mayor
      await repo.markBudgetNotified(expA, "2026-10-01", ["forecast"], "forecast", 0);

      const since = new Date(Date.now() - 60_000);
      const feed = (await repo.listNotifications([expA], since, 30)).filter((n) => n.ruleName === "Feed rule" || n.kind.startsWith("budget_"));
      expect(feed.map((n) => n.kind).sort()).toEqual(["budget_exceeded", "budget_forecast", "fired", "resolved"]);
      expect(feed.some((n) => n.kind.includes("warning"))).toBe(false);
      expect(feed.find((n) => n.kind === "resolved")).toMatchObject({ ruleName: "Feed rule", experimentName: "a", metric: "error_rate", comparator: "above", value: 1, threshold: 5, budgetUsd: null });
      expect(feed.find((n) => n.kind === "budget_exceeded")).toMatchObject({ ruleId: null, metric: null, budgetUsd: 50, warnPercent: 80 });
      expect((await repo.listNotifications([expA], since, 30)).map((n) => n.at)).toEqual([...(await repo.listNotifications([expA], since, 30)).map((n) => n.at)].sort().reverse());
      expect((await repo.listNotifications([expA], since, 30)).some((n) => n.ruleName === "Feed elsewhere")).toBe(false); // otro agente
      expect(await repo.listNotifications([expA], new Date(Date.now() + 60_000), 30)).toEqual([]); // nada es más nuevo que el futuro
      expect(await repo.listNotifications([expA], since, 1)).toHaveLength(1);
      expect(await repo.listNotifications([], since, 30)).toEqual([]);
      expect(await repo.listNotifications(["not-a-uuid"], since, 30)).toEqual([]);
      // el presupuesto y sus avisos son de este test: los de «budgets» parten de cero
      await repo.deleteBudget(expA);
      await pool.query(`DELETE FROM budget_notifications WHERE experiment_id = $1`, [expA]);
    });

    it("keeps one read mark per person that only moves forward", async () => {
      expect(await repo.getNotificationsReadAt(userId)).toBeNull();
      await repo.markNotificationsRead(userId, new Date("2026-10-10T10:00:00.000Z"));
      expect(await repo.getNotificationsReadAt(userId)).toBe("2026-10-10T10:00:00.000Z");
      await repo.markNotificationsRead(userId, new Date("2026-10-09T10:00:00.000Z")); // un reloj atrasado no deshace lo leído
      expect(await repo.getNotificationsReadAt(userId)).toBe("2026-10-10T10:00:00.000Z");
      expect(await repo.getNotificationsReadAt("not-a-uuid")).toBeNull();
    });

    it("gives the evaluator every enabled rule with its experiment's service name and organization", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "Evaluable" }));
      const found = (await repo.listEvaluableRules()).find((r) => r.rule.id === rule.id)!;
      expect(found.experiment).toEqual({ name: "a", serviceName: `alerts-a-${stamp}`, organizationId: orgId });
      expect(found.status).toBeNull();
      expect((await repo.listEvaluableRules()).some((r) => r.rule.name === "Disabled one")).toBe(false);
    });

    it("counts the emails sent since a moment, per organization, from alerts and budgets", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "Counter" }));
      const before = await repo.emailsSentSince(orgId, new Date(Date.now() - 1000));
      await repo.recordEvaluation(rule.id, status("firing"), { ruleId: rule.id, experimentId: expA, kind: "fired", value: 9, threshold: 5, emailed: 3 });
      await repo.markBudgetNotified(expB, "2026-10-01", ["warning"], "warning", 2);
      expect(await repo.emailsSentSince(orgId, new Date(Date.now() - 1000))).toBe(before + 5);
      expect(await repo.emailsSentSince(otherOrgId, new Date(Date.now() - 1000))).toBe(0);
      expect(await repo.emailsSentSince(orgId, new Date(Date.now() + 60_000))).toBe(0);
    });

    it("purges old history by age", async () => {
      const rule = await repo.createRule(expA, userId, input({ name: "Old history" }));
      await repo.recordEvaluation(rule.id, status("firing"), { ruleId: rule.id, experimentId: expA, kind: "fired", value: 9, threshold: 5, emailed: 0 });
      await pool.query(`UPDATE alert_events SET at = now() - interval '100 days' WHERE rule_id = $1`, [rule.id]);
      expect(await repo.purgeEventsOlderThan(new Date(Date.now() - 90 * 86_400_000))).toBeGreaterThanOrEqual(1);
      expect((await repo.listEvents(expA, 200)).items.some((e) => e.ruleId === rule.id)).toBe(false);
    });
  });

  describe("budgets", () => {
    it("upserts, reads and deletes one budget per experiment", async () => {
      expect(await repo.getBudget(expA)).toBeNull();
      const first = await repo.upsertBudget(expA, userId, { monthlyUsd: 100.5, warnPercent: 80, recipients: ["fin@x.io"], enabled: true });
      expect(first).toMatchObject({ monthlyUsd: 100.5, warnPercent: 80, recipients: ["fin@x.io"], enabled: true });
      const second = await repo.upsertBudget(expA, userId, { monthlyUsd: 250, warnPercent: 90, recipients: [], enabled: false });
      expect(second).toMatchObject({ monthlyUsd: 250, warnPercent: 90, enabled: false });
      expect((await pool.query(`SELECT count(*)::int AS n FROM cost_budgets WHERE experiment_id = $1`, [expA])).rows[0].n).toBe(1);
      expect(await repo.deleteBudget(expA)).toBe(true);
      expect(await repo.deleteBudget(expA)).toBe(false);
    });

    it("the database refuses a budget of zero or a warning of 100 %", async () => {
      await expect(pool.query(`INSERT INTO cost_budgets (experiment_id, monthly_usd) VALUES ($1, 0)`, [expB])).rejects.toThrow();
      await expect(pool.query(`INSERT INTO cost_budgets (experiment_id, monthly_usd, warn_percent) VALUES ($1, 10, 100)`, [expB])).rejects.toThrow();
    });

    it("lists only enabled budgets for the evaluator, with their experiment", async () => {
      await repo.upsertBudget(expA, userId, { monthlyUsd: 100, warnPercent: 80, recipients: [], enabled: true });
      await repo.upsertBudget(expB, userId, { monthlyUsd: 100, warnPercent: 80, recipients: [], enabled: false });
      const list = await repo.listEvaluableBudgets();
      expect(list.some((b) => b.budget.experimentId === expA && b.experiment.organizationId === orgId)).toBe(true);
      expect(list.some((b) => b.budget.experimentId === expB)).toBe(false);
    });

    it("remembers which levels were notified in a month, once, and starts clean the next month", async () => {
      await repo.markBudgetNotified(expA, "2026-09-01", ["exceeded", "warning", "forecast"], "exceeded", 2);
      await repo.markBudgetNotified(expA, "2026-09-01", ["exceeded", "warning", "forecast"], "exceeded", 7); // idempotente
      expect(await repo.notifiedLevels(expA, "2026-09-01")).toEqual(new Set(["exceeded", "warning", "forecast"]));
      expect(await repo.notifiedLevels(expA, "2026-10-01")).toEqual(new Set());
      const { rows } = await pool.query<{ level: string; emailed: number }>(`SELECT level, emailed FROM budget_notifications WHERE experiment_id = $1 AND month = '2026-09-01' ORDER BY level`, [expA]);
      expect(rows).toEqual([{ level: "exceeded", emailed: 2 }, { level: "forecast", emailed: 0 }, { level: "warning", emailed: 0 }]);
    });

    it("stores the cost per day, rewrites a day, and sums a range with both ends included", async () => {
      await repo.upsertDailyCost(expB, "2026-10-01", 5);
      await repo.upsertDailyCost(expB, "2026-10-02", 10);
      await repo.upsertDailyCost(expB, "2026-10-02", 12.5); // se reescribe, no se suma
      await repo.upsertDailyCost(expB, "2026-10-03", 1);
      await repo.upsertDailyCost(expB, "2026-09-30", 999);
      expect(await repo.spentBetween(expB, "2026-10-01", "2026-10-02")).toBe(17.5);
      expect(await repo.spentBetween(expB, "2026-10-01", "2026-10-31")).toBe(18.5);
      expect(await repo.spentBetween(expA, "2026-10-01", "2026-10-31")).toBe(0);
      expect(await repo.daysWithCost(expB, "2026-10-01", "2026-10-31")).toEqual(new Set(["2026-10-01", "2026-10-02", "2026-10-03"]));
    });

    it("deleting the experiment removes its budget, history and costs", async () => {
      const identity = new PostgresIdentityRepository(pool);
      const temp = (await identity.createExperiment(orgId, "temp", `alerts-t-${stamp}`)).id;
      await repo.upsertBudget(temp, userId, { monthlyUsd: 10, warnPercent: 80, recipients: [], enabled: true });
      await repo.upsertDailyCost(temp, "2026-10-01", 1);
      await repo.markBudgetNotified(temp, "2026-10-01", ["warning"], "warning", 1);
      await pool.query(`DELETE FROM experiments WHERE id = $1`, [temp]);
      for (const table of ["cost_budgets", "experiment_daily_cost", "budget_notifications"]) {
        expect((await pool.query(`SELECT 1 FROM ${table} WHERE experiment_id = $1`, [temp])).rowCount).toBe(0);
      }
    });
  });

  describe("the evaluator over the real repository", () => {
    it("fires, persists, resolves, and enforces the daily email cap counted in the database", async () => {
      const rule = await repo.createRule(expOther, userId, input({ name: "End to end", recipients: ["a@x.io", "b@x.io", "c@x.io"] }));
      let value = 9;
      const source: AlertMetricSource = { measure: async (): Promise<Sample> => ({ value, samples: 100 }), cost: async () => 0, reset: () => undefined };
      const sent: string[][] = [];
      const mail: EmailSender = {
        sendInvitationEmail: async () => undefined,
        sendReportSnapshotEmail: async () => undefined,
        sendAlertEmail: async (p) => (sent.push(p.to), p.to.length),
        sendBudgetEmail: async () => 0,
      };
      const only = (items: Awaited<ReturnType<PostgresAlertRepository["listEvaluableRules"]>>) => items.filter((i) => i.rule.id === rule.id);
      // aísla la regla de las demás de la base de datos
      const scoped = Object.create(repo) as PostgresAlertRepository;
      scoped.listEvaluableRules = async () => only(await repo.listEvaluableRules());
      scoped.listEvaluableBudgets = async () => [];
      // la organización ya envió 99 de 100 hoy: solo cabe un destinatario
      await pool.query(`INSERT INTO alert_events (rule_id, experiment_id, kind, value, threshold, emailed) VALUES ($1, $2, 'reminder', 1, 1, 99)`, [rule.id, expOther]);

      const evaluator = new AlertEvaluator(scoped, source, mail, "https://mt.example.com", () => new Date(), 100);
      expect(await evaluator.run()).toMatchObject({ rules: 1, fired: 1, failed: 0 });
      expect(sent).toEqual([["a@x.io"]]);
      const open = await repo.listOpen([expOther]);
      expect(open.map((a) => a.ruleId)).toContain(rule.id);

      value = 1;
      expect(await evaluator.run()).toMatchObject({ resolved: 1 });
      expect(sent).toHaveLength(1); // el tope está agotado: la resolución se registra pero no se envía
      expect((await repo.listOpen([expOther])).map((a) => a.ruleId)).not.toContain(rule.id);
      const events = (await repo.listEvents(expOther, 50)).items.filter((e) => e.ruleId === rule.id);
      expect(events.map((e) => [e.kind, e.emailed])).toEqual([["resolved", 0], ["fired", 1], ["reminder", 99]]);
    });
  });
});
