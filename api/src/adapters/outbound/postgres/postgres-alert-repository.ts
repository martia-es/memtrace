import type { Pool } from "pg";
import type { AlertRepository, AlertRuleWithStatus, EvaluableBudget, EvaluableRule, NewAlertEvent, OpenAlert } from "@/application/ports/alert-repository";
import type { AlertEvent, AppNotification, AlertRule, AlertRuleInput, AlertStatus, BudgetLevel, CostBudget, CostBudgetInput } from "@/domain/alert";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const isoOrNull = (v: Ts | null): string | null => (v === null ? null : iso(v));
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente «no existe»
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NotificationRow {
  id: string;
  kind: AppNotification["kind"];
  at: Ts;
  experiment_id: string;
  experiment_name: string;
  rule_id: string | null;
  rule_name: string | null;
  metric: AppNotification["metric"];
  comparator: AppNotification["comparator"];
  value: number | null;
  threshold: number | null;
  budget_usd: number | null;
  warn_percent: number | null;
}

interface RuleRow {
  id: string;
  experiment_id: string;
  name: string;
  metric: AlertRule["metric"];
  custom_metric_id: string | null;
  comparator: AlertRule["comparator"];
  threshold: number;
  window_minutes: number;
  min_samples: number;
  reminder_minutes: number | null;
  recipients: string[];
  enabled: boolean;
  created_at: Ts;
  updated_at: Ts;
}
const RULE_COLUMNS = "id, experiment_id, name, metric, custom_metric_id, comparator, threshold, window_minutes, min_samples, reminder_minutes, recipients, enabled, created_at, updated_at";
const prefixed = (alias: string, columns: string) => columns.split(",").map((c) => `${alias}.${c.trim()}`).join(", ");

const toRule = (r: RuleRow): AlertRule => ({
  id: r.id,
  experimentId: r.experiment_id,
  name: r.name,
  metric: r.metric,
  customMetricId: r.custom_metric_id,
  comparator: r.comparator,
  threshold: r.threshold,
  windowMinutes: r.window_minutes,
  minSamples: r.min_samples,
  reminderMinutes: r.reminder_minutes,
  recipients: r.recipients,
  enabled: r.enabled,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

interface StatusColumns {
  state: AlertStatus["state"] | null;
  since: Ts | null;
  last_value: number | null;
  last_checked_at: Ts | null;
  last_notified_at: Ts | null;
}
const STATUS_COLUMNS = "s.state, s.since, s.last_value, s.last_checked_at, s.last_notified_at";
const toStatus = (r: StatusColumns): AlertStatus | null =>
  r.state === null || r.since === null
    ? null
    : { state: r.state, since: iso(r.since), lastValue: r.last_value, lastCheckedAt: isoOrNull(r.last_checked_at), lastNotifiedAt: isoOrNull(r.last_notified_at) };

interface EventRow {
  id: string;
  rule_id: string;
  experiment_id: string;
  at: Ts;
  kind: AlertEvent["kind"];
  value: number;
  threshold: number;
  emailed: number;
}

interface BudgetRow {
  experiment_id: string;
  monthly_usd: string;
  warn_percent: number;
  recipients: string[];
  enabled: boolean;
  updated_at: Ts;
}
const toBudget = (r: BudgetRow): CostBudget => ({ experimentId: r.experiment_id, monthlyUsd: Number(r.monthly_usd), warnPercent: r.warn_percent, recipients: r.recipients, enabled: r.enabled, updatedAt: iso(r.updated_at) });

/** Reglas, estado, historial, presupuestos y coste diario (ADR-086). */
export class PostgresAlertRepository implements AlertRepository {
  constructor(private readonly pool: Pool) {}

  async listRules(experimentId: string): Promise<AlertRuleWithStatus[]> {
    if (!UUID.test(experimentId)) return [];
    const { rows } = await this.pool.query<RuleRow & StatusColumns>(
      `SELECT ${prefixed("r", RULE_COLUMNS)}, ${STATUS_COLUMNS}
         FROM alert_rules r LEFT JOIN alert_states s ON s.rule_id = r.id
        WHERE r.experiment_id = $1 ORDER BY r.created_at, r.id`,
      [experimentId],
    );
    return rows.map((r) => ({ rule: toRule(r), status: toStatus(r) }));
  }

  async getRule(experimentId: string, ruleId: string): Promise<AlertRule | null> {
    if (!UUID.test(experimentId) || !UUID.test(ruleId)) return null;
    const { rows } = await this.pool.query<RuleRow>(`SELECT ${RULE_COLUMNS} FROM alert_rules WHERE experiment_id = $1 AND id = $2`, [experimentId, ruleId]);
    return rows[0] ? toRule(rows[0]) : null;
  }

  async createRule(experimentId: string, userId: string, input: AlertRuleInput): Promise<AlertRule> {
    const { rows } = await this.pool.query<RuleRow>(
      `INSERT INTO alert_rules (experiment_id, name, metric, custom_metric_id, comparator, threshold, window_minutes, min_samples, reminder_minutes, recipients, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${RULE_COLUMNS}`,
      [experimentId, input.name, input.metric, input.customMetricId, input.comparator, input.threshold, input.windowMinutes, input.minSamples, input.reminderMinutes, input.recipients, input.enabled, userId],
    );
    return toRule(rows[0]!);
  }

  async updateRule(experimentId: string, ruleId: string, input: AlertRuleInput): Promise<AlertRule | null> {
    if (!UUID.test(experimentId) || !UUID.test(ruleId)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<RuleRow>(
        `UPDATE alert_rules SET name = $3, metric = $4, custom_metric_id = $5, comparator = $6, threshold = $7, window_minutes = $8, min_samples = $9,
                reminder_minutes = $10, recipients = $11, enabled = $12, updated_at = now()
          WHERE experiment_id = $1 AND id = $2 RETURNING ${RULE_COLUMNS}`,
        [experimentId, ruleId, input.name, input.metric, input.customMetricId, input.comparator, input.threshold, input.windowMinutes, input.minSamples, input.reminderMinutes, input.recipients, input.enabled],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      // otra métrica, otro umbral u otra ventana: lo medido antes ya no significa lo mismo, así que se empieza de cero
      await client.query(`DELETE FROM alert_states WHERE rule_id = $1`, [ruleId]);
      await client.query("COMMIT");
      return toRule(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRule(experimentId: string, ruleId: string): Promise<boolean> {
    if (!UUID.test(experimentId) || !UUID.test(ruleId)) return false;
    const result = await this.pool.query(`DELETE FROM alert_rules WHERE experiment_id = $1 AND id = $2`, [experimentId, ruleId]);
    return (result.rowCount ?? 0) > 0;
  }

  async listEvents(experimentId: string, limit: number, cursor?: string): Promise<{ items: AlertEvent[]; nextCursor: string | null }> {
    if (!UUID.test(experimentId)) return { items: [], nextCursor: null };
    const params: unknown[] = [experimentId];
    let where = "experiment_id = $1";
    if (cursor && /^\d+$/.test(cursor)) {
      params.push(cursor);
      where += ` AND id < $${params.length}`;
    }
    params.push(limit + 1);
    const { rows } = await this.pool.query<EventRow>(
      `SELECT id, rule_id, experiment_id, at, kind, value, threshold, emailed FROM alert_events WHERE ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit).map(
      (r): AlertEvent => ({ id: String(r.id), ruleId: r.rule_id, experimentId: r.experiment_id, at: iso(r.at), kind: r.kind, value: r.value, threshold: r.threshold, emailed: r.emailed }),
    );
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  async listOpen(experimentIds: string[]): Promise<OpenAlert[]> {
    const ids = experimentIds.filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<{ rule_id: string; name: string; experiment_id: string; experiment_name: string; metric: AlertRule["metric"]; since: Ts; last_value: number | null; threshold: number; comparator: AlertRule["comparator"] }>(
      `SELECT r.id AS rule_id, r.name, r.experiment_id, e.name AS experiment_name, r.metric, s.since, s.last_value, r.threshold, r.comparator
         FROM alert_states s JOIN alert_rules r ON r.id = s.rule_id JOIN experiments e ON e.id = r.experiment_id
        WHERE s.state = 'firing' AND r.enabled AND r.experiment_id = ANY($1::uuid[]) ORDER BY s.since, r.id`,
      [ids],
    );
    return rows.map((r) => ({
      ruleId: r.rule_id,
      ruleName: r.name,
      experimentId: r.experiment_id,
      experimentName: r.experiment_name,
      metric: r.metric,
      since: iso(r.since),
      lastValue: r.last_value,
      threshold: r.threshold,
      comparator: r.comparator,
    }));
  }

  async listNotifications(experimentIds: string[], since: Date, limit: number): Promise<AppNotification[]> {
    const ids = experimentIds.filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    // Los avisos de presupuesto de un mes en el que se saltó de nivel (de «warning» a «exceeded») dejan los dos; solo se enseña el mayor.
    const { rows } = await this.pool.query<NotificationRow>(
      `SELECT * FROM (
         SELECT 'e:' || ev.id::text AS id, ev.kind, ev.at, ev.experiment_id, ex.name AS experiment_name, ev.rule_id, r.name AS rule_name,
                r.metric, r.comparator, ev.value, ev.threshold, NULL::float8 AS budget_usd, NULL::int AS warn_percent
           FROM alert_events ev JOIN alert_rules r ON r.id = ev.rule_id JOIN experiments ex ON ex.id = ev.experiment_id
          WHERE ev.experiment_id = ANY($1::uuid[]) AND ev.kind IN ('fired', 'resolved') AND ev.at >= $2
         UNION ALL
         SELECT 'b:' || bn.experiment_id::text || ':' || bn.month::text || ':' || bn.level, 'budget_' || bn.level, bn.notified_at, bn.experiment_id, ex.name,
                NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::float8, NULL::float8, b.monthly_usd::float8, b.warn_percent
           FROM budget_notifications bn JOIN experiments ex ON ex.id = bn.experiment_id LEFT JOIN cost_budgets b ON b.experiment_id = bn.experiment_id
          WHERE bn.experiment_id = ANY($1::uuid[]) AND bn.notified_at >= $2
            AND NOT (bn.level = 'warning' AND EXISTS (SELECT 1 FROM budget_notifications x WHERE x.experiment_id = bn.experiment_id AND x.month = bn.month AND x.level = 'exceeded'))
       ) n ORDER BY n.at DESC, n.id DESC LIMIT $3`,
      [ids, since, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      at: iso(r.at),
      experimentId: r.experiment_id,
      experimentName: r.experiment_name,
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      metric: r.metric,
      comparator: r.comparator,
      value: r.value,
      threshold: r.threshold,
      budgetUsd: r.budget_usd,
      warnPercent: r.warn_percent,
    }));
  }

  async getNotificationsReadAt(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;
    const { rows } = await this.pool.query<{ read_at: Ts }>(`SELECT read_at FROM notification_reads WHERE user_id = $1`, [userId]);
    return rows[0] ? iso(rows[0].read_at) : null;
  }

  async markNotificationsRead(userId: string, at: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_reads (user_id, read_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET read_at = GREATEST(notification_reads.read_at, EXCLUDED.read_at)`,
      [userId, at],
    );
  }

  async listEvaluableRules(): Promise<EvaluableRule[]> {
    const { rows } = await this.pool.query<RuleRow & StatusColumns & { experiment_name: string; service_name: string; organization_id: string }>(
      `SELECT ${prefixed("r", RULE_COLUMNS)}, ${STATUS_COLUMNS}, e.name AS experiment_name, e.service_name, e.organization_id
         FROM alert_rules r JOIN experiments e ON e.id = r.experiment_id LEFT JOIN alert_states s ON s.rule_id = r.id
        WHERE r.enabled ORDER BY r.created_at, r.id`,
    );
    return rows.map((r) => ({ rule: toRule(r), status: toStatus(r), experiment: { name: r.experiment_name, serviceName: r.service_name, organizationId: r.organization_id } }));
  }

  async recordEvaluation(ruleId: string, status: AlertStatus, event: NewAlertEvent | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO alert_states (rule_id, state, since, last_value, last_checked_at, last_notified_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (rule_id) DO UPDATE SET state = EXCLUDED.state, since = EXCLUDED.since, last_value = EXCLUDED.last_value,
                                             last_checked_at = EXCLUDED.last_checked_at, last_notified_at = EXCLUDED.last_notified_at`,
        [ruleId, status.state, status.since, status.lastValue, status.lastCheckedAt, status.lastNotifiedAt],
      );
      if (event) {
        await client.query(`INSERT INTO alert_events (rule_id, experiment_id, kind, value, threshold, emailed) VALUES ($1, $2, $3, $4, $5, $6)`, [
          event.ruleId, event.experimentId, event.kind, event.value, event.threshold, event.emailed,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async emailsSentSince(organizationId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT (COALESCE((SELECT sum(ev.emailed) FROM alert_events ev JOIN experiments e ON e.id = ev.experiment_id WHERE e.organization_id = $1 AND ev.at >= $2), 0)
             + COALESCE((SELECT sum(b.emailed) FROM budget_notifications b JOIN experiments e ON e.id = b.experiment_id WHERE e.organization_id = $1 AND b.notified_at >= $2), 0))::text AS n`,
      [organizationId, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async purgeEventsOlderThan(cutoff: Date): Promise<number> {
    const result = await this.pool.query(`DELETE FROM alert_events WHERE at < $1`, [cutoff]);
    return result.rowCount ?? 0;
  }

  async getBudget(experimentId: string): Promise<CostBudget | null> {
    if (!UUID.test(experimentId)) return null;
    const { rows } = await this.pool.query<BudgetRow>(`SELECT experiment_id, monthly_usd, warn_percent, recipients, enabled, updated_at FROM cost_budgets WHERE experiment_id = $1`, [experimentId]);
    return rows[0] ? toBudget(rows[0]) : null;
  }

  async upsertBudget(experimentId: string, userId: string, input: CostBudgetInput): Promise<CostBudget> {
    const { rows } = await this.pool.query<BudgetRow>(
      `INSERT INTO cost_budgets (experiment_id, monthly_usd, warn_percent, recipients, enabled, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (experiment_id) DO UPDATE SET monthly_usd = EXCLUDED.monthly_usd, warn_percent = EXCLUDED.warn_percent, recipients = EXCLUDED.recipients,
                                                 enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING experiment_id, monthly_usd, warn_percent, recipients, enabled, updated_at`,
      [experimentId, input.monthlyUsd, input.warnPercent, input.recipients, input.enabled, userId],
    );
    return toBudget(rows[0]!);
  }

  async deleteBudget(experimentId: string): Promise<boolean> {
    if (!UUID.test(experimentId)) return false;
    const result = await this.pool.query(`DELETE FROM cost_budgets WHERE experiment_id = $1`, [experimentId]);
    return (result.rowCount ?? 0) > 0;
  }

  async listEvaluableBudgets(): Promise<EvaluableBudget[]> {
    const { rows } = await this.pool.query<BudgetRow & { experiment_name: string; service_name: string; organization_id: string }>(
      `SELECT b.experiment_id, b.monthly_usd, b.warn_percent, b.recipients, b.enabled, b.updated_at, e.name AS experiment_name, e.service_name, e.organization_id
         FROM cost_budgets b JOIN experiments e ON e.id = b.experiment_id WHERE b.enabled`,
    );
    return rows.map((r) => ({ budget: toBudget(r), experiment: { name: r.experiment_name, serviceName: r.service_name, organizationId: r.organization_id } }));
  }

  async notifiedLevels(experimentId: string, month: string): Promise<Set<BudgetLevel>> {
    const { rows } = await this.pool.query<{ level: BudgetLevel }>(`SELECT level FROM budget_notifications WHERE experiment_id = $1 AND month = $2`, [experimentId, month]);
    return new Set(rows.map((r) => r.level));
  }

  async markBudgetNotified(experimentId: string, month: string, levels: BudgetLevel[], notified: BudgetLevel | null, emailed: number): Promise<void> {
    for (const level of levels) {
      // el nivel realmente enviado lleva cuántos emails salieron; los menores, que ya no aportan nada, van a 0
      await this.pool.query(
        `INSERT INTO budget_notifications (experiment_id, month, level, emailed) VALUES ($1, $2, $3, $4) ON CONFLICT (experiment_id, month, level) DO NOTHING`,
        [experimentId, month, level, level === notified ? emailed : 0],
      );
    }
  }

  async upsertDailyCost(experimentId: string, day: string, costUsd: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO experiment_daily_cost (experiment_id, day, cost_usd) VALUES ($1, $2, $3)
       ON CONFLICT (experiment_id, day) DO UPDATE SET cost_usd = EXCLUDED.cost_usd, updated_at = now()`,
      [experimentId, day, costUsd],
    );
  }

  async daysWithCost(experimentId: string, from: string, to: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ day: string }>(`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM experiment_daily_cost WHERE experiment_id = $1 AND day BETWEEN $2 AND $3`, [experimentId, from, to]);
    return new Set(rows.map((r) => r.day));
  }

  async spentBetween(experimentId: string, from: string, to: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: number | null }>(`SELECT sum(cost_usd) AS total FROM experiment_daily_cost WHERE experiment_id = $1 AND day BETWEEN $2 AND $3`, [experimentId, from, to]);
    return Number(rows[0]?.total ?? 0);
  }
}
