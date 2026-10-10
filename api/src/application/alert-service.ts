import type { AuditService } from "@/application/audit-service";
import type { AlertRepository, AlertRuleWithStatus, OpenAlert } from "@/application/ports/alert-repository";
import { AlertNotFoundError, ValidationError } from "@/domain/errors";
import {
  evaluateBudget,
  monthKey,
  monthStart,
  validateAlertRule,
  validateCostBudget,
  type AlertEvent,
  type AppNotification,
  type BudgetEvaluation,
  type CostBudget,
} from "@/domain/alert";
import type { CustomMetricDefinition } from "@/domain/metrics";

export interface Actor {
  userId: string;
  email: string;
}

/** Contexto que la ruta ya resolvió al comprobar el permiso. */
export interface ExperimentRef {
  experimentId: string;
  organizationId: string;
}

/** El presupuesto con lo gastado este mes, para pintarlo. */
export interface BudgetView {
  budget: CostBudget;
  month: string;
  spentUsd: number;
  percent: number;
  projectedUsd: number | null;
}

/** Lo que enseña la campana: los avisos recientes y cuántos no ha leído esta persona (ADR-087). */
export interface NotificationFeed {
  items: Array<AppNotification & { read: boolean }>;
  unread: number;
}

/** Los avisos de la campana llegan hasta 14 días atrás y como mucho 30: es una bandeja de aviso, no un historial (ese es el de Alerts). */
const NOTIFICATION_DAYS = 14;
const NOTIFICATION_LIMIT = 30;

export interface AlertsOverview {
  rules: AlertRuleWithStatus[];
  events: AlertEvent[];
  budget: BudgetView | null;
}

const RECENT_EVENTS = 20;
const DAY = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Lo que las personas ven y cambian de alertas y presupuestos (ADR-086). La autorización (`experiment:read` para ver,
 * `alert:manage` para cambiar) la decide la ruta; cada cambio queda en el registro de auditoría.
 */
export class AlertService {
  constructor(
    private readonly repo: AlertRepository,
    private readonly audit: AuditService,
    /** las gráficas guardadas del experimento, para comprobar que una regla `custom` apunta a una válida */
    private readonly customMetrics: (experimentId: string) => Promise<Array<{ id: string; definition: Record<string, unknown> }>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async overview(experimentId: string): Promise<AlertsOverview> {
    const [rules, events, budget] = await Promise.all([this.repo.listRules(experimentId), this.repo.listEvents(experimentId, RECENT_EVENTS), this.budgetView(experimentId)]);
    return { rules, events: events.items, budget };
  }

  listEvents(experimentId: string, options: { limit?: number; cursor?: string } = {}) {
    return this.repo.listEvents(experimentId, Math.min(Math.max(options.limit ?? 50, 1), 200), options.cursor);
  }

  /** Alertas disparadas en esos experimentos (los que la persona puede leer), para la campana. */
  listOpen(experimentIds: string[]): Promise<OpenAlert[]> {
    return this.repo.listOpen(experimentIds);
  }

  /** Los avisos recientes de los experimentos que la persona puede leer, cada uno marcado como leído o no según su marca. */
  async notifications(userId: string, experimentIds: string[]): Promise<NotificationFeed> {
    const since = new Date(this.now().getTime() - NOTIFICATION_DAYS * 86_400_000);
    const [items, readAt] = await Promise.all([this.repo.listNotifications(experimentIds, since, NOTIFICATION_LIMIT), this.repo.getNotificationsReadAt(userId)]);
    const mark = readAt === null ? null : new Date(readAt).getTime();
    const withRead = items.map((n) => ({ ...n, read: mark !== null && new Date(n.at).getTime() <= mark }));
    return { items: withRead, unread: withRead.filter((n) => !n.read).length };
  }

  /** «Marcar todo como leído»: todo lo que había hasta ahora. Lo que llegue después vuelve a contar como nuevo. */
  markNotificationsRead(userId: string): Promise<void> {
    return this.repo.markNotificationsRead(userId, this.now());
  }

  async createRule(ref: ExperimentRef, actor: Actor, body: Record<string, unknown>) {
    const input = validateAlertRule(body);
    await this.checkCustomMetric(ref.experimentId, input.metric, input.customMetricId);
    const rule = await this.repo.createRule(ref.experimentId, actor.userId, input);
    await this.record(ref, actor, "alert.create", rule.id, { name: rule.name, metric: rule.metric, recipients: rule.recipients.length });
    return rule;
  }

  async updateRule(ref: ExperimentRef, actor: Actor, ruleId: string, body: Record<string, unknown>) {
    const input = validateAlertRule(body);
    await this.checkCustomMetric(ref.experimentId, input.metric, input.customMetricId);
    const rule = await this.repo.updateRule(ref.experimentId, ruleId, input);
    if (!rule) throw new AlertNotFoundError("Alert not found in this experiment");
    await this.record(ref, actor, "alert.update", rule.id, { name: rule.name, metric: rule.metric, enabled: rule.enabled, recipients: rule.recipients.length });
    return rule;
  }

  async deleteRule(ref: ExperimentRef, actor: Actor, ruleId: string): Promise<void> {
    const existing = await this.repo.getRule(ref.experimentId, ruleId);
    if (!existing || !(await this.repo.deleteRule(ref.experimentId, ruleId))) throw new AlertNotFoundError("Alert not found in this experiment");
    await this.record(ref, actor, "alert.delete", ruleId, { name: existing.name, metric: existing.metric });
  }

  // ------------------------------------------------------------ presupuesto

  async budgetView(experimentId: string): Promise<BudgetView | null> {
    const budget = await this.repo.getBudget(experimentId);
    if (!budget) return null;
    const now = this.now();
    const first = monthStart(now);
    const spentUsd = await this.repo.spentBetween(experimentId, DAY(first), DAY(now));
    // la misma regla del evaluador, sin avisos previos: aquí solo interesa el porcentaje y la previsión
    const evaluation: BudgetEvaluation = evaluateBudget(budget, spentUsd, now, new Set());
    return { budget, month: monthKey(now), spentUsd, percent: evaluation.percent, projectedUsd: evaluation.projectedUsd };
  }

  async setBudget(ref: ExperimentRef, actor: Actor, body: Record<string, unknown>): Promise<BudgetView> {
    const input = validateCostBudget(body);
    const budget = await this.repo.upsertBudget(ref.experimentId, actor.userId, input);
    await this.record(ref, actor, "budget.update", ref.experimentId, { monthlyUsd: budget.monthlyUsd, warnPercent: budget.warnPercent, recipients: budget.recipients.length, enabled: budget.enabled });
    return (await this.budgetView(ref.experimentId))!;
  }

  async deleteBudget(ref: ExperimentRef, actor: Actor): Promise<void> {
    if (!(await this.repo.deleteBudget(ref.experimentId))) throw new AlertNotFoundError("This experiment has no budget");
    await this.record(ref, actor, "budget.delete", ref.experimentId, {});
  }

  // ------------------------------------------------------------ internos

  /** Una regla `custom` mide UN número: una gráfica guardada de este experimento, con un solo paso y sin desglose. */
  private async checkCustomMetric(experimentId: string, metric: string, customMetricId: string | null): Promise<void> {
    if (metric !== "custom") return;
    const chart = (await this.customMetrics(experimentId)).find((c) => c.id === customMetricId);
    if (!chart) throw new ValidationError("Invalid alert rule", { customMetricId: "That chart does not exist in this experiment" });
    const definition = chart.definition as unknown as Partial<CustomMetricDefinition>;
    if (!Array.isArray(definition.stepTypes) || definition.stepTypes.length !== 1) {
      throw new ValidationError("Invalid alert rule", { customMetricId: "An alert needs a chart about one step; this one covers several" });
    }
    if (definition.groupByAttribute) {
      throw new ValidationError("Invalid alert rule", { customMetricId: "An alert needs a single number; this chart is split by a detail" });
    }
  }

  private record(ref: ExperimentRef, actor: Actor, action: "alert.create" | "alert.update" | "alert.delete" | "budget.update" | "budget.delete", targetId: string, metadata: Record<string, unknown>) {
    return this.audit.record({
      organizationId: ref.organizationId,
      experimentId: ref.experimentId,
      actorUserId: actor.userId,
      actorLabel: actor.email,
      action,
      targetType: action.startsWith("budget") ? "budget" : "alert",
      targetId,
      metadata,
    });
  }
}
