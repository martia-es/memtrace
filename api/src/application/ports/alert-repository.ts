import type { AlertEvent, AlertEventKind, AppNotification, AlertRule, AlertRuleInput, AlertStatus, BudgetLevel, CostBudget, CostBudgetInput } from "@/domain/alert";

/** Una regla con su estado actual (null si aún no se ha evaluado). */
export interface AlertRuleWithStatus {
  rule: AlertRule;
  status: AlertStatus | null;
}

/** Una regla que hay que evaluar, con el contexto del experimento al que pertenece. */
export interface EvaluableRule extends AlertRuleWithStatus {
  experiment: { name: string; serviceName: string; organizationId: string };
}

export interface EvaluableBudget {
  budget: CostBudget;
  experiment: { name: string; serviceName: string; organizationId: string };
}

/** Una alerta que está disparada ahora, para la campana de la app. */
export interface OpenAlert {
  ruleId: string;
  ruleName: string;
  experimentId: string;
  experimentName: string;
  metric: AlertRule["metric"];
  since: string;
  lastValue: number | null;
  threshold: number;
  comparator: AlertRule["comparator"];
}

export interface NewAlertEvent {
  ruleId: string;
  experimentId: string;
  kind: AlertEventKind;
  value: number;
  threshold: number;
  emailed: number;
}

/** Reglas, estado, historial, presupuestos y coste diario en PostgreSQL (ADR-086). */
export interface AlertRepository {
  listRules(experimentId: string): Promise<AlertRuleWithStatus[]>;
  getRule(experimentId: string, ruleId: string): Promise<AlertRule | null>;
  createRule(experimentId: string, userId: string, input: AlertRuleInput): Promise<AlertRule>;
  /** null si la regla no es de ese experimento. Cambiar la regla reinicia su estado: el valor anterior ya no significa lo mismo. */
  updateRule(experimentId: string, ruleId: string, input: AlertRuleInput): Promise<AlertRule | null>;
  deleteRule(experimentId: string, ruleId: string): Promise<boolean>;
  listEvents(experimentId: string, limit: number, cursor?: string): Promise<{ items: AlertEvent[]; nextCursor: string | null }>;
  /** Alertas disparadas ahora en esos experimentos, las más antiguas primero. */
  listOpen(experimentIds: string[]): Promise<OpenAlert[]>;

  /** Alertas disparadas o resueltas y avisos de presupuesto desde `since` en esos experimentos, los más recientes primero (ADR-094). */
  listNotifications(experimentIds: string[], since: Date, limit: number): Promise<AppNotification[]>;
  /** Hasta cuándo ha leído esa persona sus notificaciones; null si nunca ha marcado nada. */
  getNotificationsReadAt(userId: string): Promise<string | null>;
  markNotificationsRead(userId: string, at: Date): Promise<void>;

  listEvaluableRules(): Promise<EvaluableRule[]>;
  /** Guarda el estado y, si hubo transición, su evento, en una sola transacción. */
  recordEvaluation(ruleId: string, status: AlertStatus, event: NewAlertEvent | null): Promise<void>;
  /** Emails de alerta y de presupuesto enviados hoy (UTC) a las direcciones de esa organización. */
  emailsSentSince(organizationId: string, since: Date): Promise<number>;
  purgeEventsOlderThan(cutoff: Date): Promise<number>;

  getBudget(experimentId: string): Promise<CostBudget | null>;
  upsertBudget(experimentId: string, userId: string, input: CostBudgetInput): Promise<CostBudget>;
  deleteBudget(experimentId: string): Promise<boolean>;
  listEvaluableBudgets(): Promise<EvaluableBudget[]>;
  notifiedLevels(experimentId: string, month: string): Promise<Set<BudgetLevel>>;
  markBudgetNotified(experimentId: string, month: string, levels: BudgetLevel[], notified: BudgetLevel | null, emailed: number): Promise<void>;
  upsertDailyCost(experimentId: string, day: string, costUsd: number): Promise<void>;
  /** Días del rango `[from, to]` (YYYY-MM-DD) que ya tienen coste guardado. */
  daysWithCost(experimentId: string, from: string, to: string): Promise<Set<string>>;
  /** Suma del coste diario guardado entre esos días, ambos incluidos. */
  spentBetween(experimentId: string, from: string, to: string): Promise<number>;
}
