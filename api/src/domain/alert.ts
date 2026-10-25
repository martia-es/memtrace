import { ValidationError } from "./errors";

/** Alertas y presupuestos de coste (ADR-086). Todo lo de aquí es lógica pura: ni bases de datos ni reloj propio. */

export const ALERT_METRICS = ["error_rate", "latency_p95", "cost", "satisfaction", "custom", "security_detections", "security_blocked", "eval_score", "eval_stale"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export type Comparator = "above" | "below";
export type AlertState = "ok" | "firing" | "no_data";
export type AlertEventKind = "fired" | "resolved" | "reminder";

export const MAX_RECIPIENTS = 10;
export const MIN_WINDOW_MINUTES = 5;
export const MAX_WINDOW_MINUTES = 1440;
export const MIN_REMINDER_MINUTES = 15;
export const MAX_REMINDER_MINUTES = 10_080;
export const DEFAULT_MIN_SAMPLES = 20;
export const MAX_NAME_LENGTH = 80;
/** Tope de emails de alerta por organización y día: pasado esto se sigue registrando y mostrando, pero no se envía. */
export const DAILY_EMAIL_CAP_PER_ORGANIZATION = 100;

/** Unidad en la que se escribe el umbral de cada métrica (la que ve la persona, no la interna). */
export const METRIC_UNIT: Record<AlertMetric, string> = {
  error_rate: "%", latency_p95: "ms", cost: "USD", satisfaction: "%", custom: "", security_detections: "", security_blocked: "", eval_score: "%", eval_stale: "days",
};
export const METRIC_LABEL: Record<AlertMetric, string> = {
  error_rate: "Error rate",
  latency_p95: "Latency (p95)",
  cost: "Cost",
  satisfaction: "User satisfaction",
  custom: "Custom chart",
  security_detections: "Security detections",
  security_blocked: "Blocked tool calls",
  eval_score: "Evaluation score",
  eval_stale: "Days since the last evaluation",
};

/** Las reglas de seguridad cuentan eventos en una ventana de tiempo (ADR-086, actualización 2026-10-25). */
export const SECURITY_METRICS: readonly AlertMetric[] = ["security_detections", "security_blocked"];
/** Las de evaluación miran el último run offline, no una ventana: no hay ventana que elegir. */
export const EVALUATION_METRICS: readonly AlertMetric[] = ["eval_score", "eval_stale"];
export const isSecurityMetric = (metric: AlertMetric): boolean => SECURITY_METRICS.includes(metric);
export const isEvaluationMetric = (metric: AlertMetric): boolean => EVALUATION_METRICS.includes(metric);
/** La ventana que se guarda en una regla de evaluación, que no la usa (la columna exige un valor válido). */
export const EVALUATION_WINDOW_MINUTES = MIN_WINDOW_MINUTES;
export const EVAL_MODES = ["absolute", "drop"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];
const SLUG = /^[a-z][a-z0-9_.-]{0,39}$/;
const MAX_TARGET_LENGTH = 120;
const MAX_SCORE_LENGTH = 80;

/** Lo propio de cada tipo de regla; los campos que no aplican a la métrica van vacíos. */
export interface AlertRuleParams {
  /** seguridad: solo este detector (`secret_leak`...); null = cualquiera */
  detector?: string | null;
  /** seguridad: solo esta severidad; null = cualquiera */
  severity?: string | null;
  /** evaluación: un dataset por nombre, o un prefijo de nombre de run si termina en `/` (`redteam/`) */
  target?: string;
  /** eval_score: el score a vigilar; "" = «cualquier check» (el ataque gana si alguno falla, como en el ASR) */
  score?: string;
  mode?: EvalMode;
}

export interface AlertRule {
  id: string;
  experimentId: string;
  name: string;
  metric: AlertMetric;
  /** la gráfica guardada que mide una regla `custom`; null si no es custom o si la gráfica se borró */
  customMetricId: string | null;
  comparator: Comparator;
  threshold: number;
  windowMinutes: number;
  /** observaciones mínimas en la ventana para fiarse del valor (trazas o votos); 0 en cost y custom */
  minSamples: number;
  /** minutos entre avisos mientras siga disparada; null = no repetir */
  reminderMinutes: number | null;
  recipients: string[];
  enabled: boolean;
  params: AlertRuleParams;
  createdAt: string;
  updatedAt: string;
}

/** Lo que una persona escribe al crear o cambiar una regla. */
export type AlertRuleInput = Pick<AlertRule, "name" | "metric" | "customMetricId" | "comparator" | "threshold" | "windowMinutes" | "minSamples" | "reminderMinutes" | "recipients" | "enabled" | "params">;

export interface AlertStatus {
  state: AlertState;
  /** desde cuándo está en este estado */
  since: string;
  lastValue: number | null;
  lastCheckedAt: string | null;
  lastNotifiedAt: string | null;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  experimentId: string;
  at: string;
  kind: AlertEventKind;
  value: number;
  threshold: number;
  /** a cuántas direcciones se envió; 0 si no había, si no hay proveedor de correo o si se alcanzó el tope diario */
  emailed: number;
}

export type NotificationKind = "fired" | "resolved" | "budget_warning" | "budget_exceeded" | "budget_forecast";

/**
 * Un aviso de la campana (ADR-094): una alerta que se disparó o se resolvió, o un aviso de presupuesto. Los campos de la alerta son
 * null en los de presupuesto y al revés; los recordatorios no entran, repetirían el mismo problema.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  at: string;
  experimentId: string;
  experimentName: string;
  ruleId: string | null;
  ruleName: string | null;
  metric: AlertRule["metric"] | null;
  comparator: AlertRule["comparator"] | null;
  value: number | null;
  threshold: number | null;
  /** del presupuesto actual; null si ya no hay */
  budgetUsd: number | null;
  warnPercent: number | null;
  /** de la regla (alertas) */
  windowMinutes: number | null;
  /** gasto del mes cuando se avisó (presupuesto); null en avisos anteriores a guardarlo */
  spentUsd: number | null;
  /** cuántas direcciones recibían el correo */
  recipients: number;
}

const EMAIL = /^[^\s@<>"',;()]{1,64}@[^\s@<>"',;()]{1,255}\.[A-Za-z]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAlertMetric(value: unknown): value is AlertMetric {
  return typeof value === "string" && (ALERT_METRICS as readonly string[]).includes(value);
}

/** Direcciones en minúsculas, sin repetir y con forma de email; hasta 10. */
export function validateRecipients(value: unknown, field = "recipients"): string[] {
  if (!Array.isArray(value)) throw new ValidationError("Invalid recipients", { [field]: "Must be a list of email addresses" });
  const emails: string[] = [];
  for (const raw of value) {
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (email.length > 254 || !EMAIL.test(email)) throw new ValidationError("Invalid recipients", { [field]: `"${String(raw).slice(0, 60)}" is not a valid email address` });
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > MAX_RECIPIENTS) throw new ValidationError("Invalid recipients", { [field]: `At most ${MAX_RECIPIENTS} addresses` });
  return emails;
}

function thresholdRange(metric: AlertMetric): { min: number; max: number } {
  if (metric === "error_rate" || metric === "satisfaction") return { min: 0, max: 100 };
  if (metric === "latency_p95") return { min: 1, max: 3_600_000 };
  if (metric === "cost") return { min: 0, max: 1_000_000_000 };
  if (isSecurityMetric(metric)) return { min: 0, max: 1_000_000 };
  if (metric === "eval_score") return { min: 0, max: 100 };
  if (metric === "eval_stale") return { min: 0, max: 3650 };
  return { min: -1e15, max: 1e15 };
}

/** Valida lo propio del tipo de regla; lo que no aplica a la métrica se descarta. */
function validateParams(metric: AlertMetric, input: unknown, fields: Record<string, string>): AlertRuleParams {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (isSecurityMetric(metric)) {
    const pick = (key: "detector" | "severity"): string | null => {
      const value = raw[key];
      if (value === undefined || value === null || value === "") return null;
      if (typeof value !== "string" || !SLUG.test(value)) {
        fields[`params.${key}`] = "Lower-case letters, digits, _ . -; or empty for any";
        return null;
      }
      return value;
    };
    return { detector: pick("detector"), severity: pick("severity") };
  }
  if (isEvaluationMetric(metric)) {
    const target = typeof raw.target === "string" ? raw.target.trim() : "";
    if (target.length < 1 || target.length > MAX_TARGET_LENGTH) fields["params.target"] = `A dataset name or a run prefix such as redteam/ (1 to ${MAX_TARGET_LENGTH} characters)`;
    if (metric === "eval_stale") return { target };
    const score = raw.score === undefined || raw.score === null ? "" : raw.score;
    if (typeof score !== "string" || score.length > MAX_SCORE_LENGTH) fields["params.score"] = `A score name up to ${MAX_SCORE_LENGTH} characters, or empty for any check`;
    const mode = raw.mode ?? "absolute";
    if (typeof mode !== "string" || !(EVAL_MODES as readonly string[]).includes(mode)) fields["params.mode"] = "Must be absolute or drop";
    return { target, score: typeof score === "string" ? score.trim() : "", mode: mode as EvalMode };
  }
  return {};
}

/** Cómo se compara cada tipo de regla. Seguridad y «sin evaluar» siempre «por encima»; el score, según el modo. */
function forcedComparator(metric: AlertMetric, params: AlertRuleParams): Comparator | null {
  if (isSecurityMetric(metric) || metric === "eval_stale") return "above";
  if (metric === "eval_score") return params.mode === "drop" ? "above" : "below";
  return null;
}

/** La regla en una frase, para los correos y las listas. */
export function describeAlertRule(rule: Pick<AlertRule, "metric" | "comparator" | "threshold" | "windowMinutes" | "params">): string {
  const { metric, params } = rule;
  if (isSecurityMetric(metric)) {
    const what = metric === "security_blocked" ? "tool calls blocked" : `${params.detector ?? "any"} detections`;
    const sev = params.severity ? `, severity ${params.severity}` : "";
    return `More than ${rule.threshold} ${what}${sev} in ${rule.windowMinutes} min`;
  }
  if (metric === "eval_stale") return `No finished run of ${params.target ?? "?"} in more than ${rule.threshold} days`;
  if (metric === "eval_score") {
    const score = params.score ? params.score : "any check";
    return params.mode === "drop"
      ? `${params.target ?? "?"}: ${score} dropped more than ${rule.threshold} points against the previous run`
      : `${params.target ?? "?"}: ${score} below ${rule.threshold} % in the latest run`;
  }
  return `${METRIC_LABEL[metric]} ${rule.comparator} ${rule.threshold} (last ${rule.windowMinutes} min)`;
}

/** Valida y normaliza una regla. Lanza `ValidationError` con el campo que falla. */
export function validateAlertRule(input: Record<string, unknown>): AlertRuleInput {
  const fields: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) fields.name = `Between 1 and ${MAX_NAME_LENGTH} characters`;

  const metric = isAlertMetric(input.metric) ? input.metric : null;
  if (!metric) fields.metric = `Must be one of: ${ALERT_METRICS.join(", ")}`;

  let customMetricId: string | null = null;
  if (metric === "custom") {
    if (typeof input.customMetricId !== "string" || !UUID.test(input.customMetricId)) fields.customMetricId = "Choose a saved custom chart";
    else customMetricId = input.customMetricId;
  } else if (input.customMetricId !== undefined && input.customMetricId !== null) {
    fields.customMetricId = "Only a custom chart rule points to a chart";
  }

  const params = metric ? validateParams(metric, input.params, fields) : {};
  const forced = metric ? forcedComparator(metric, params) : null;
  const comparator: Comparator | null = forced ?? (input.comparator === "above" || input.comparator === "below" ? input.comparator : null);
  if (!comparator) fields.comparator = "Must be above or below";

  const threshold = input.threshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) fields.threshold = "Must be a number";
  else if (metric) {
    const { min, max } = thresholdRange(metric);
    if (threshold < min || threshold > max) fields.threshold = `Must be between ${min} and ${max}${METRIC_UNIT[metric] ? ` ${METRIC_UNIT[metric]}` : ""}`;
  }

  const windowMinutes = metric && isEvaluationMetric(metric) ? EVALUATION_WINDOW_MINUTES : input.windowMinutes;
  if (typeof windowMinutes !== "number" || !Number.isInteger(windowMinutes) || windowMinutes < MIN_WINDOW_MINUTES || windowMinutes > MAX_WINDOW_MINUTES) {
    fields.windowMinutes = `Whole minutes from ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES}`;
  }

  const needsSamples = metric === "error_rate" || metric === "latency_p95" || metric === "satisfaction" || metric === "eval_score";
  let minSamples = 0;
  if (needsSamples) {
    const given = input.minSamples ?? DEFAULT_MIN_SAMPLES;
    if (typeof given !== "number" || !Number.isInteger(given) || given < 1 || given > 100_000) fields.minSamples = "A whole number from 1 to 100000";
    else minSamples = given;
  }

  let reminderMinutes: number | null = null;
  if (input.reminderMinutes !== undefined && input.reminderMinutes !== null) {
    const given = input.reminderMinutes;
    if (typeof given !== "number" || !Number.isInteger(given) || given < MIN_REMINDER_MINUTES || given > MAX_REMINDER_MINUTES) {
      fields.reminderMinutes = `Whole minutes from ${MIN_REMINDER_MINUTES} to ${MAX_REMINDER_MINUTES}, or empty for no reminders`;
    } else reminderMinutes = given;
  }

  let recipients: string[] = [];
  try {
    recipients = validateRecipients(input.recipients ?? []);
  } catch (error) {
    if (error instanceof ValidationError) Object.assign(fields, error.fields);
    else throw error;
  }

  const enabled = input.enabled === undefined ? true : input.enabled;
  if (typeof enabled !== "boolean") fields.enabled = "Must be true or false";

  if (Object.keys(fields).length > 0 || !metric || !comparator || typeof threshold !== "number" || typeof windowMinutes !== "number") {
    throw new ValidationError("Invalid alert rule", fields);
  }
  return { name, metric, customMetricId, comparator, threshold, windowMinutes: windowMinutes as number, minSamples, reminderMinutes, recipients, enabled: enabled as boolean, params };
}

/** Una medida de la ventana: el valor (en la unidad del umbral) y con cuántas observaciones se calculó. */
export interface Sample {
  value: number | null;
  samples: number;
}

export interface PreviousStatus {
  state: AlertState;
  since: string;
  lastValue: number | null;
  lastNotifiedAt: string | null;
}

export interface Evaluation {
  status: Omit<AlertStatus, "lastCheckedAt">;
  /** la transición que hay que registrar y avisar; null si no cambia nada que contar */
  event: AlertEventKind | null;
}

export function isBreached(rule: Pick<AlertRule, "comparator" | "threshold">, value: number): boolean {
  return rule.comparator === "above" ? value > rule.threshold : value < rule.threshold;
}

/**
 * Máquina de estados de una regla (ADR-086). Con menos observaciones que `minSamples` no hay medida fiable: la regla pasa a
 * `no_data`, salvo que esté disparada, que sigue disparada (la falta de datos no resuelve una alerta; solo una medida buena
 * dentro del umbral lo hace).
 */
export function evaluateRule(rule: Pick<AlertRule, "comparator" | "threshold" | "minSamples" | "reminderMinutes">, sample: Sample, previous: PreviousStatus | null, now: Date): Evaluation {
  const nowIso = now.toISOString();
  const before = previous?.state ?? "ok";
  const trusted = sample.value !== null && Number.isFinite(sample.value) && sample.samples >= rule.minSamples;

  if (!trusted) {
    if (before === "firing") return { status: { state: "firing", since: previous!.since, lastValue: previous!.lastValue, lastNotifiedAt: previous!.lastNotifiedAt }, event: null };
    return {
      status: { state: "no_data", since: before === "no_data" ? previous!.since : nowIso, lastValue: previous?.lastValue ?? null, lastNotifiedAt: previous?.lastNotifiedAt ?? null },
      event: null,
    };
  }

  const value = sample.value as number;
  if (isBreached(rule, value)) {
    if (before !== "firing") return { status: { state: "firing", since: nowIso, lastValue: value, lastNotifiedAt: previous?.lastNotifiedAt ?? null }, event: "fired" };
    const reference = Date.parse(previous!.lastNotifiedAt ?? previous!.since);
    const due = rule.reminderMinutes !== null && now.getTime() - reference >= rule.reminderMinutes * 60_000;
    return { status: { state: "firing", since: previous!.since, lastValue: value, lastNotifiedAt: previous!.lastNotifiedAt }, event: due ? "reminder" : null };
  }
  if (before === "firing") return { status: { state: "ok", since: nowIso, lastValue: value, lastNotifiedAt: previous!.lastNotifiedAt }, event: "resolved" };
  return { status: { state: "ok", since: before === "ok" ? (previous?.since ?? nowIso) : nowIso, lastValue: value, lastNotifiedAt: previous?.lastNotifiedAt ?? null }, event: null };
}

/** El valor de una alerta tal como se escribe en un mensaje: «12.5 %», «1,800 ms», «$3.20». */
export function formatAlertValue(metric: AlertMetric, value: number, params?: AlertRuleParams): string {
  if (isSecurityMetric(metric)) return String(Math.round(value));
  if (metric === "eval_stale") return `${Number(value.toFixed(1))} days`;
  if (metric === "eval_score") return `${Number(value.toFixed(1))} ${params?.mode === "drop" ? "points" : "%"}`;
  if (metric === "cost") return `$${value.toFixed(2)}`;
  if (metric === "error_rate" || metric === "satisfaction") return `${Number(value.toFixed(1))} %`;
  if (metric === "latency_p95") return `${Math.round(value).toLocaleString("en-US")} ms`;
  return String(Number(value.toFixed(4)));
}

// ---------------------------------------------------------------- presupuestos de coste

export type BudgetLevel = "warning" | "exceeded" | "forecast";
export const BUDGET_LEVELS: readonly BudgetLevel[] = ["warning", "exceeded", "forecast"];
export const DEFAULT_WARN_PERCENT = 80;
/** Antes de este día del mes la proyección a fin de mes es demasiado ruidosa para avisar. */
export const MIN_FORECAST_DAYS = 3;
const DAY_MS = 86_400_000;

export interface CostBudget {
  experimentId: string;
  monthlyUsd: number;
  warnPercent: number;
  recipients: string[];
  enabled: boolean;
  updatedAt: string;
}

export type CostBudgetInput = Pick<CostBudget, "monthlyUsd" | "warnPercent" | "recipients" | "enabled">;

export function validateCostBudget(input: Record<string, unknown>): CostBudgetInput {
  const fields: Record<string, string> = {};
  const monthlyUsd = input.monthlyUsd;
  if (typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd) || monthlyUsd <= 0 || monthlyUsd > 1_000_000_000) fields.monthlyUsd = "A positive amount in USD";
  const warnPercent = input.warnPercent ?? DEFAULT_WARN_PERCENT;
  if (typeof warnPercent !== "number" || !Number.isInteger(warnPercent) || warnPercent < 1 || warnPercent > 99) fields.warnPercent = "A whole percentage from 1 to 99";
  let recipients: string[] = [];
  try {
    recipients = validateRecipients(input.recipients ?? []);
  } catch (error) {
    if (error instanceof ValidationError) Object.assign(fields, error.fields);
    else throw error;
  }
  const enabled = input.enabled === undefined ? true : input.enabled;
  if (typeof enabled !== "boolean") fields.enabled = "Must be true or false";
  if (Object.keys(fields).length > 0) throw new ValidationError("Invalid budget", fields);
  return { monthlyUsd: monthlyUsd as number, warnPercent: warnPercent as number, recipients, enabled: enabled as boolean };
}

/** Primer instante (UTC) del mes de `now`. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Primer día del mes, `YYYY-MM-01`, que identifica «este mes» en los avisos ya enviados. */
export function monthKey(now: Date): string {
  return monthStart(now).toISOString().slice(0, 10);
}

/** Gasto previsto a fin de mes si sigue al ritmo actual; null antes del día {@link MIN_FORECAST_DAYS} o sin gasto. */
export function projectMonthEnd(spentUsd: number, now: Date): number | null {
  const start = monthStart(now).getTime();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsed = now.getTime() - start;
  if (elapsed < MIN_FORECAST_DAYS * DAY_MS || spentUsd <= 0) return null;
  return (spentUsd * (end - start)) / elapsed;
}

export interface BudgetEvaluation {
  percent: number;
  projectedUsd: number | null;
  /** el aviso que toca enviar ahora (como mucho uno por pasada) */
  notify: BudgetLevel | null;
  /** niveles que quedan dados por avisados: el enviado y los menores que ya no aportan nada */
  markNotified: BudgetLevel[];
}

/**
 * Qué avisar de un presupuesto (ADR-086): un solo aviso por mes y nivel, y el más grave primero. Si el gasto salta de golpe de
 * 70 % a 120 %, se avisa «superado» y no «aviso» después. La previsión solo avisa si aún no se ha llegado al aviso.
 */
export function evaluateBudget(budget: Pick<CostBudget, "monthlyUsd" | "warnPercent">, spentUsd: number, now: Date, alreadyNotified: ReadonlySet<BudgetLevel>): BudgetEvaluation {
  const percent = (spentUsd / budget.monthlyUsd) * 100;
  const projectedUsd = projectMonthEnd(spentUsd, now);
  if (percent >= 100) {
    return { percent, projectedUsd, notify: alreadyNotified.has("exceeded") ? null : "exceeded", markNotified: ["exceeded", "warning", "forecast"] };
  }
  if (percent >= budget.warnPercent) {
    return { percent, projectedUsd, notify: alreadyNotified.has("warning") ? null : "warning", markNotified: ["warning", "forecast"] };
  }
  if (projectedUsd !== null && projectedUsd >= budget.monthlyUsd) {
    return { percent, projectedUsd, notify: alreadyNotified.has("forecast") ? null : "forecast", markNotified: ["forecast"] };
  }
  return { percent, projectedUsd, notify: null, markNotified: [] };
}
