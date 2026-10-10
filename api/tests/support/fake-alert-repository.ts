import type { AlertRepository, AlertRuleWithStatus, EvaluableBudget, EvaluableRule, NewAlertEvent, OpenAlert } from "@/application/ports/alert-repository";
import type { AlertEvent, AlertRule, AlertRuleInput, AlertStatus, BudgetLevel, CostBudget, CostBudgetInput } from "@/domain/alert";

export interface Ctx {
  name: string;
  serviceName: string;
  organizationId: string;
}

/** Repositorio de alertas en memoria, con las mismas reglas observables que el de PostgreSQL. */
export class FakeAlertRepository implements AlertRepository {
  rules: AlertRule[] = [];
  statuses = new Map<string, AlertStatus>();
  events: AlertEvent[] = [];
  budgets = new Map<string, CostBudget>();
  notified = new Map<string, Map<string, { emailed: number }>>();
  dailyCost = new Map<string, Map<string, number>>();
  experiments = new Map<string, Ctx>();
  /** correos ya enviados hoy por organización, para probar el tope */
  sentToday = new Map<string, number>();
  log: string[] = [];
  private seq = 0;

  ctx(experimentId: string): Ctx {
    return this.experiments.get(experimentId) ?? { name: "Weather", serviceName: "weather", organizationId: "org1" };
  }

  async listRules(experimentId: string): Promise<AlertRuleWithStatus[]> {
    return this.rules.filter((r) => r.experimentId === experimentId).map((rule) => ({ rule, status: this.statuses.get(rule.id) ?? null }));
  }
  async getRule(experimentId: string, ruleId: string) {
    return this.rules.find((r) => r.experimentId === experimentId && r.id === ruleId) ?? null;
  }
  async createRule(experimentId: string, _userId: string, input: AlertRuleInput): Promise<AlertRule> {
    const rule: AlertRule = { ...input, id: `rule-${++this.seq}`, experimentId, createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z" };
    this.rules.push(rule);
    return rule;
  }
  async updateRule(experimentId: string, ruleId: string, input: AlertRuleInput) {
    const index = this.rules.findIndex((r) => r.experimentId === experimentId && r.id === ruleId);
    if (index < 0) return null;
    this.rules[index] = { ...this.rules[index]!, ...input };
    this.statuses.delete(ruleId);
    return this.rules[index]!;
  }
  async deleteRule(experimentId: string, ruleId: string) {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => !(r.experimentId === experimentId && r.id === ruleId));
    return this.rules.length < before;
  }
  async listEvents(experimentId: string, limit: number) {
    return { items: this.events.filter((e) => e.experimentId === experimentId).slice(-limit).reverse(), nextCursor: null };
  }
  async listOpen(): Promise<OpenAlert[]> {
    return [];
  }

  async listEvaluableRules(): Promise<EvaluableRule[]> {
    return this.rules.filter((r) => r.enabled).map((rule) => ({ rule, status: this.statuses.get(rule.id) ?? null, experiment: this.ctx(rule.experimentId) }));
  }
  async recordEvaluation(ruleId: string, status: AlertStatus, event: NewAlertEvent | null) {
    this.log.push(`save:${ruleId}`);
    this.statuses.set(ruleId, status);
    if (event) {
      this.events.push({ ...event, id: String(++this.seq), at: status.lastCheckedAt ?? "" });
      this.sentToday.set(this.ctx(event.experimentId).organizationId, (this.sentToday.get(this.ctx(event.experimentId).organizationId) ?? 0) + event.emailed);
    }
  }
  async emailsSentSince(organizationId: string) {
    return this.sentToday.get(organizationId) ?? 0;
  }
  async purgeEventsOlderThan() {
    return 0;
  }

  async getBudget(experimentId: string) {
    return this.budgets.get(experimentId) ?? null;
  }
  async upsertBudget(experimentId: string, _userId: string, input: CostBudgetInput): Promise<CostBudget> {
    const budget: CostBudget = { ...input, experimentId, updatedAt: "2026-10-10T00:00:00.000Z" };
    this.budgets.set(experimentId, budget);
    return budget;
  }
  async deleteBudget(experimentId: string) {
    return this.budgets.delete(experimentId);
  }
  async listEvaluableBudgets(): Promise<EvaluableBudget[]> {
    return [...this.budgets.values()].filter((b) => b.enabled).map((budget) => ({ budget, experiment: this.ctx(budget.experimentId) }));
  }
  async notifiedLevels(experimentId: string, month: string) {
    return new Set([...(this.notified.get(`${experimentId}|${month}`)?.keys() ?? [])] as BudgetLevel[]);
  }
  async markBudgetNotified(experimentId: string, month: string, levels: BudgetLevel[], notified: BudgetLevel | null, emailed: number) {
    this.log.push(`budget-saved:${notified}`);
    const key = `${experimentId}|${month}`;
    const map = this.notified.get(key) ?? new Map();
    for (const level of levels) if (!map.has(level)) map.set(level, { emailed: level === notified ? emailed : 0 });
    this.notified.set(key, map);
    this.sentToday.set(this.ctx(experimentId).organizationId, (this.sentToday.get(this.ctx(experimentId).organizationId) ?? 0) + emailed);
  }
  async upsertDailyCost(experimentId: string, day: string, costUsd: number) {
    const map = this.dailyCost.get(experimentId) ?? new Map();
    map.set(day, costUsd);
    this.dailyCost.set(experimentId, map);
  }
  async daysWithCost(experimentId: string, from: string, to: string) {
    return new Set([...(this.dailyCost.get(experimentId)?.keys() ?? [])].filter((d) => d >= from && d <= to));
  }
  async spentBetween(experimentId: string, from: string, to: string) {
    return [...(this.dailyCost.get(experimentId) ?? [])].filter(([d]) => d >= from && d <= to).reduce((sum, [, c]) => sum + c, 0);
  }
}
