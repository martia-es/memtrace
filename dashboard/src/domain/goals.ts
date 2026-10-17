import type { AlertRuleDto, AlertRuleWithStatusDto, BudgetViewDto } from "@contract";
import { tr } from "./translate";

/**
 * Objetivos del Overview (M1). Un objetivo no es un concepto nuevo del backend: es una regla de alerta (ADR-086)
 * de error o de latencia, o el presupuesto mensual de coste, leída con otras palabras. El semáforo sale del estado que ya
 * calcula el evaluador, sobre la ventana de la propia regla, no sobre el rango que la persona tenga elegido arriba.
 */

export type GoalMetric = "error_rate" | "latency_p95";
export type GoalTone = "ok" | "warn" | "error" | "neutral";

export interface Goal {
  tone: GoalTone;
  /** lo que dice la pastilla: «On track», «Close», «Over goal»… */
  label: string;
  /** el límite en una frase corta: «under 3 %» */
  limit: string;
  /** el valor medido por el evaluador en la ventana del objetivo, si lo hay */
  current: number | null;
  windowMinutes: number;
}

/** Desde qué fracción del límite el semáforo pasa a ámbar. */
export const CLOSE_AT = 0.9;

/** Ventana de los objetivos que se crean de una vez: siempre las últimas 24 h. */
export const GOAL_WINDOW_MINUTES = 1440;

export const STARTER_GOALS: ReadonlyArray<{ metric: GoalMetric; name: string; threshold: number }> = [
  { metric: "error_rate", get name() { return tr("goals.errors_goal"); }, threshold: 3 },
  { metric: "latency_p95", get name() { return tr("goals.response_time_goal"); }, threshold: 5000 },
];

export function limitText(metric: GoalMetric, threshold: number): string {
  if (metric === "error_rate") return tr("goals.under_value", { value: Number(threshold.toFixed(1)) });
  return threshold >= 1000 ? tr("goals.under_value_s", { value: Number((threshold / 1000).toFixed(1)) }) : tr("goals.under_value_ms", { value: Math.round(threshold) });
}

/** El objetivo de una métrica: la primera regla activa que vigila un máximo. Sin ella no hay objetivo. */
export function goalOf(metric: GoalMetric, rules: ReadonlyArray<AlertRuleWithStatusDto>): Goal | null {
  const found = rules.find((r) => r.rule.metric === metric && r.rule.comparator === "above" && r.rule.enabled);
  if (!found) return null;
  const { rule, status } = found;
  const base = { limit: limitText(metric, rule.threshold), current: status?.lastValue ?? null, windowMinutes: rule.windowMinutes };
  if (!status) return { ...base, tone: "neutral", label: tr("goals.waiting_for_first_check") };
  if (status.state === "firing") return { ...base, tone: "error", label: tr("goals.over_goal") };
  if (status.state === "no_data" || status.lastValue === null) return { ...base, tone: "neutral", label: tr("goals.not_enough_data") };
  const ratio = rule.threshold > 0 ? status.lastValue / rule.threshold : status.lastValue > 0 ? Infinity : 0;
  return ratio >= CLOSE_AT ? { ...base, tone: "warn", label: tr("goals.close") } : { ...base, tone: "ok", label: tr("goals.on_track") };
}

export interface BudgetGoal {
  tone: GoalTone;
  label: string;
  spentUsd: number;
  monthlyUsd: number;
  /** previsión a fin de mes; null antes del tercer día */
  projectedUsd: number | null;
}

/** El objetivo de coste es el presupuesto mensual; su aviso es el porcentaje que ya tiene configurado. */
export function budgetGoalOf(view: BudgetViewDto | null): BudgetGoal | null {
  if (!view || !view.budget.enabled) return null;
  const { percent, budget, spentUsd } = view;
  const base = { spentUsd, monthlyUsd: budget.monthlyUsd, projectedUsd: view.projectedUsd };
  if (percent >= 100) return { ...base, tone: "error", label: tr("goals.over_goal") };
  if (percent >= budget.warnPercent) return { ...base, tone: "warn", label: tr("goals.close") };
  if (view.projectedUsd !== null && view.projectedUsd >= budget.monthlyUsd) return { ...base, tone: "warn", label: tr("goals.forecast_over") };
  return { ...base, tone: "ok", label: tr("goals.on_track") };
}

/** Los objetivos de partida que faltan por crear: los de error y latencia que aún no tienen una regla activa. */
export function missingStarterGoals(rules: ReadonlyArray<AlertRuleWithStatusDto>) {
  return STARTER_GOALS.filter((g) => !goalOf(g.metric, rules));
}

export function starterRuleBody(goal: (typeof STARTER_GOALS)[number]): Pick<AlertRuleDto, "name" | "metric" | "customMetricId" | "comparator" | "threshold" | "windowMinutes" | "minSamples" | "reminderMinutes" | "recipients" | "enabled"> {
  return { name: goal.name, metric: goal.metric, customMetricId: null, comparator: "above", threshold: goal.threshold, windowMinutes: GOAL_WINDOW_MINUTES, minSamples: 10, reminderMinutes: null, recipients: [], enabled: true };
}
