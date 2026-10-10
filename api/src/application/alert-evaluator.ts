import type { AlertMetricSource } from "@/application/ports/alert-metric-source";
import type { AlertRepository, EvaluableBudget, EvaluableRule } from "@/application/ports/alert-repository";
import type { EmailSender } from "@/application/ports/email-sender";
import { DAILY_EMAIL_CAP_PER_ORGANIZATION, evaluateBudget, evaluateRule, formatAlertValue, monthKey, monthStart, type AlertStatus } from "@/domain/alert";

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface EvaluationSummary {
  rules: number;
  fired: number;
  resolved: number;
  reminders: number;
  budgets: number;
  budgetNotices: number;
  failed: number;
}

/**
 * Una pasada del evaluador de alertas y presupuestos (ADR-086), pensada para un CronJob cada cinco minutos. Un fallo en una regla o
 * en un presupuesto no detiene a los demás. El correo se envía ANTES de guardar el estado: si algo falla entre una cosa y la otra,
 * lo peor es un aviso repetido, nunca un aviso perdido.
 */
export class AlertEvaluator {
  constructor(
    private readonly repo: AlertRepository,
    private readonly source: AlertMetricSource,
    private readonly email: EmailSender,
    private readonly appUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly dailyCap: number = DAILY_EMAIL_CAP_PER_ORGANIZATION,
  ) {}

  private link(experimentId: string): string {
    return `${this.appUrl.replace(/\/+$/, "")}/e/${encodeURIComponent(experimentId)}/alerts`;
  }

  /** A quién se puede escribir hoy sin pasar del tope de la organización. */
  private async allowed(organizationId: string, recipients: string[], now: Date): Promise<string[]> {
    if (recipients.length === 0) return [];
    const sent = await this.repo.emailsSentSince(organizationId, startOfUtcDay(now));
    return recipients.slice(0, Math.max(0, this.dailyCap - sent));
  }

  async run(): Promise<EvaluationSummary> {
    const now = this.now();
    const summary: EvaluationSummary = { rules: 0, fired: 0, resolved: 0, reminders: 0, budgets: 0, budgetNotices: 0, failed: 0 };
    this.source.reset();

    for (const item of await this.repo.listEvaluableRules()) {
      summary.rules += 1;
      try {
        const event = await this.evaluateOne(item, now);
        if (event === "fired") summary.fired += 1;
        else if (event === "resolved") summary.resolved += 1;
        else if (event === "reminder") summary.reminders += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`[alerts] rule ${item.rule.id} failed:`, error);
      }
    }

    for (const item of await this.repo.listEvaluableBudgets()) {
      summary.budgets += 1;
      try {
        if (await this.evaluateBudgetOf(item, now)) summary.budgetNotices += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`[alerts] budget of ${item.budget.experimentId} failed:`, error);
      }
    }
    return summary;
  }

  private async evaluateOne({ rule, status, experiment }: EvaluableRule, now: Date) {
    const sample = await this.source.measure(rule, { experimentId: rule.experimentId, serviceName: experiment.serviceName }, now);
    const result = evaluateRule(rule, sample, status, now);
    const next: AlertStatus = { ...result.status, lastCheckedAt: now.toISOString() };

    let event = null;
    if (result.event) {
      const to = await this.allowed(experiment.organizationId, rule.recipients, now);
      let emailed = 0;
      if (to.length > 0) {
        try {
          emailed = await this.email.sendAlertEmail({
            to,
            kind: result.event,
            ruleName: rule.name,
            experimentName: experiment.name,
            metric: rule.metric,
            comparator: rule.comparator,
            windowMinutes: rule.windowMinutes,
            valueText: formatAlertValue(rule.metric, result.status.lastValue ?? 0),
            thresholdText: formatAlertValue(rule.metric, rule.threshold),
            link: this.link(rule.experimentId),
          });
        } catch (error) {
          console.error(`[alerts] could not email rule ${rule.id}:`, error);
        }
      }
      // los recordatorios cuentan desde el último aviso, haya salido correo o no
      next.lastNotifiedAt = now.toISOString();
      event = { ruleId: rule.id, experimentId: rule.experimentId, kind: result.event, value: result.status.lastValue ?? 0, threshold: rule.threshold, emailed };
    }
    await this.repo.recordEvaluation(rule.id, next, event);
    return result.event;
  }

  /** Renueva el coste de hoy, de ayer y de los días del mes que falten, y avisa si toca. Devuelve si salió un aviso. */
  private async evaluateBudgetOf({ budget, experiment }: EvaluableBudget, now: Date): Promise<boolean> {
    const today = startOfUtcDay(now);
    const first = monthStart(now);
    const yesterday = new Date(today.getTime() - DAY_MS);

    const have = await this.repo.daysWithCost(budget.experimentId, day(first), day(today));
    const toRefresh: Date[] = [];
    for (let d = first; d.getTime() <= today.getTime(); d = new Date(d.getTime() + DAY_MS)) {
      const recent = d.getTime() >= yesterday.getTime();
      if (recent || !have.has(day(d))) toRefresh.push(d);
    }
    for (const d of toRefresh) {
      const end = new Date(Math.min(d.getTime() + DAY_MS, now.getTime()));
      await this.repo.upsertDailyCost(budget.experimentId, day(d), await this.source.cost({ experimentId: budget.experimentId, serviceName: experiment.serviceName }, d, end));
    }

    const spent = await this.repo.spentBetween(budget.experimentId, day(first), day(today));
    const month = monthKey(now);
    const notified = await this.repo.notifiedLevels(budget.experimentId, month);
    const result = evaluateBudget(budget, spent, now, notified);
    if (!result.notify) return false;

    const to = await this.allowed(experiment.organizationId, budget.recipients, now);
    let emailed = 0;
    if (to.length > 0) {
      try {
        emailed = await this.email.sendBudgetEmail({
          to,
          level: result.notify,
          experimentName: experiment.name,
          budgetUsd: budget.monthlyUsd,
          spentUsd: spent,
          percent: result.percent,
          projectedUsd: result.projectedUsd,
          link: this.link(budget.experimentId),
        });
      } catch (error) {
        console.error(`[alerts] could not email budget of ${budget.experimentId}:`, error);
      }
    }
    await this.repo.markBudgetNotified(budget.experimentId, month, result.markNotified, result.notify, emailed);
    return true;
  }
}
