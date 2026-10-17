import type { AlertEventDto, AlertRuleDto, AlertStatusDto, NotificationDto, OpenAlertDto } from "@contract";
import { formatRelativeTime } from "@/domain/format";

/** Textos y estados de las alertas (ADR-086): todo lo que la pantalla dice sobre una regla, sin tocar el DOM. */

export type AlertMetric = AlertRuleDto["metric"];

export const METRICS: ReadonlyArray<{ value: AlertMetric; label: string; unit: string; hint: string }> = [
  { value: "error_rate", label: "Error rate", unit: "%", hint: "Share of conversations whose last step failed" },
  { value: "latency_p95", label: "Latency (p95)", unit: "ms", hint: "Time that 95 % of the answers stay under" },
  { value: "cost", label: "Cost", unit: "USD", hint: "Estimated spend in the window" },
  { value: "satisfaction", label: "User satisfaction", unit: "%", hint: "Share of 👍 among the 👍 and 👎 votes" },
  { value: "custom", label: "Custom chart", unit: "", hint: "The number of a chart you saved in Charts" },
];

export const WINDOWS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 180, label: "3 hours" },
  { value: 360, label: "6 hours" },
  { value: 1440, label: "24 hours" },
];

export const REMINDERS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: "Never repeat" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every day" },
];

export const metricLabel = (metric: AlertMetric): string => METRICS.find((m) => m.value === metric)?.label ?? metric;
export const metricUnit = (metric: AlertMetric): string => METRICS.find((m) => m.value === metric)?.unit ?? "";
/** Las métricas cuyo valor solo es fiable con un mínimo de trazas o de votos. */
export const needsSamples = (metric: AlertMetric): boolean => metric === "error_rate" || metric === "latency_p95" || metric === "satisfaction";
export const samplesLabel = (metric: AlertMetric): string => (metric === "satisfaction" ? "votes" : "conversations");

export function windowText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} min`;
}

/** «12.5 %», «1,834 ms», «$3.20». */
export function formatValue(metric: AlertMetric, value: number | null): string {
  if (value === null) return "—";
  if (metric === "cost") return `$${value.toFixed(2)}`;
  if (metric === "error_rate" || metric === "satisfaction") return `${Number(value.toFixed(1))} %`;
  if (metric === "latency_p95") return `${Math.round(value).toLocaleString("en-US")} ms`;
  return String(Number(value.toFixed(4)));
}

/** Qué se vigila, sin la ventana: «Error rate above 5 %». */
export function thresholdPhrase(rule: Pick<AlertRuleDto, "metric" | "comparator" | "threshold">, chartName?: string | null): string {
  const subject = rule.metric === "custom" ? (chartName ?? "Custom chart") : metricLabel(rule.metric);
  return `${subject} ${rule.comparator} ${formatValue(rule.metric, rule.threshold)}`;
}

/** La condición de una regla en una frase: «Error rate above 5 % over 15 min». */
export function conditionText(rule: Pick<AlertRuleDto, "metric" | "comparator" | "threshold" | "windowMinutes">, chartName?: string | null): string {
  return `${thresholdPhrase(rule, chartName)} over ${windowText(rule.windowMinutes)}`;
}

export type StateTone = "ok" | "error" | "warn" | "neutral";

/** El estado que se enseña de una regla: lo que ha dicho el evaluador, o por qué no hay nada que decir. */
export function stateOf(rule: Pick<AlertRuleDto, "enabled" | "metric" | "customMetricId">, status: AlertStatusDto | null): { label: string; tone: StateTone } {
  if (!rule.enabled) return { label: "Paused", tone: "neutral" };
  if (rule.metric === "custom" && rule.customMetricId === null) return { label: "Chart deleted", tone: "warn" };
  if (!status) return { label: "Waiting for first check", tone: "neutral" };
  if (status.state === "firing") return { label: "Firing", tone: "error" };
  if (status.state === "no_data") return { label: "Not enough data", tone: "warn" };
  return { label: "OK", tone: "ok" };
}

export const EVENT_LABEL: Record<AlertEventDto["kind"], { label: string; tone: StateTone }> = {
  fired: { label: "Fired", tone: "error" },
  reminder: { label: "Still firing", tone: "warn" },
  resolved: { label: "Resolved", tone: "ok" },
};

/** Cuánta gente recibió el aviso, en una frase corta para el historial. */
export function emailedText(emailed: number, recipients: number | null): string {
  if (emailed === 0) return recipients === 0 ? "No recipients" : "Not emailed";
  return `${emailed} email${emailed === 1 ? "" : "s"}`;
}

/** Direcciones escritas separadas por comas, punto y coma, espacios o líneas. */
export function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «Your limit is» / «Your minimum is»: el límite según se vigile por arriba o por abajo. */
const limitWord = (comparator: "above" | "below") => (comparator === "above" ? "limit" : "minimum");

/** La alerta que sigue disparada, como la cuenta la campana (ADR-094): «Latency (p95) is 2,807 ms. Your limit is 5 ms.» y cuánto lleva así. */
export function openAlertView(a: Pick<OpenAlertDto, "metric" | "comparator" | "lastValue" | "threshold" | "windowMinutes">): { text: string; detail: string } {
  const subject = a.metric === "custom" ? "Custom chart" : metricLabel(a.metric);
  return {
    text: `${subject} is ${formatValue(a.metric, a.lastValue)}. Your ${limitWord(a.comparator)} is ${formatValue(a.metric, a.threshold)}.`,
    detail: `${a.comparator === "above" ? "over the limit" : "under the minimum"} for ${windowText(a.windowMinutes)}`,
  };
}

/** Cómo se cuenta un aviso de la campana (ADR-094): el titular, la frase con el valor, el detalle que va tras el agente y el tono. */
export function notificationView(
  n: Pick<NotificationDto, "kind" | "ruleName" | "metric" | "comparator" | "value" | "threshold" | "budgetUsd" | "warnPercent" | "windowMinutes" | "spentUsd">,
): { title: string; text: string; detail: string; tone: StateTone; cta: string } {
  const budget = n.budgetUsd === null ? null : formatValue("cost", n.budgetUsd);
  const gone = "The monthly budget was removed since.";
  // el gasto exacto solo está en los avisos que se guardaron con él; en los anteriores, una frase sin cifra
  const spent = (fallback: string) => (budget === null ? gone : n.spentUsd === null ? fallback : `You have spent ${formatValue("cost", n.spentUsd)} of your ${budget} monthly budget.`);
  const estimate = n.spentUsd === null ? "" : "estimate from the price catalog";
  if (n.kind === "budget_warning") return { title: `Budget reached ${n.warnPercent ?? "the warning"} %`, text: spent(`Your ${budget} monthly budget is filling up.`), detail: estimate, tone: "warn", cta: "See costs" };
  if (n.kind === "budget_exceeded") return { title: "Budget exceeded", text: spent(`The month went over your ${budget} budget.`), detail: estimate, tone: "error", cta: "See costs" };
  if (n.kind === "budget_forecast") return { title: "On track to exceed the budget", text: budget === null ? gone : `At this pace the month ends over your ${budget} budget.`, detail: "", tone: "warn", cta: "See costs" };
  const name = n.ruleName ?? "An alert";
  const metric = n.metric ?? "custom";
  const comparator = n.comparator ?? "above";
  const subject = metric === "custom" ? "Custom chart" : metricLabel(metric);
  const limit = n.threshold === null ? "" : formatValue(metric, n.threshold);
  if (n.kind === "resolved") {
    const verb = comparator === "above" ? "dropped" : "rose";
    const side = comparator === "above" ? `under your ${limit} limit` : `over your ${limit} minimum`;
    return { title: `${name} is back to normal`, text: limit ? `${subject} ${verb} to ${formatValue(metric, n.value)}, ${side}.` : `${subject} is ${formatValue(metric, n.value)} now.`, detail: "", tone: "ok", cta: "View alert" };
  }
  const detail = n.windowMinutes === null ? "" : `${comparator === "above" ? "over the limit" : "under the minimum"} for ${windowText(n.windowMinutes)}`;
  return { title: name, text: limit ? `${subject} is ${formatValue(metric, n.value)}. Your ${limitWord(comparator)} is ${limit}.` : `${subject} is ${formatValue(metric, n.value)}.`, detail, tone: "error", cta: "View alert" };
}

/** «5 min ago» dentro de la última hora, «3 h ago» el mismo día, «Yesterday» el día anterior y «N d ago» más atrás. */
export function bellTime(iso: string, nowMs: number): string {
  const then = new Date(iso);
  const now = new Date(nowMs);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days === 1 && nowMs - then.getTime() >= 3_600_000) return "Yesterday";
  return formatRelativeTime(iso, nowMs);
}

/** El límite de una alerta siempre cae al 66 % de su barra, así que pasarse se ve como una barra que lo rebasa. */
export const GAUGE_LIMIT_AT = 66;
export function gaugeFill(value: number | null, threshold: number): number | null {
  if (value === null) return null;
  if (threshold <= 0) return value > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((value / threshold) * GAUGE_LIMIT_AT)));
}

/** Barra de gasto: el porcentaje que se pinta (sin pasar de 100) y su tono. */
export function budgetTone(percent: number, warnPercent: number): StateTone {
  if (percent >= 100) return "error";
  if (percent >= warnPercent) return "warn";
  return "ok";
}
