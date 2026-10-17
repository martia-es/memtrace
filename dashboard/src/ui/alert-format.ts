import type { AlertEventDto, AlertRuleDto, AlertStatusDto, NotificationDto, OpenAlertDto } from "@contract";
import { formatRelativeTime } from "./i18n/format";
import { t, tp } from "./i18n";

/** Textos y estados de las alertas (ADR-086): todo lo que la pantalla dice sobre una regla, sin tocar el DOM. */

export type AlertMetric = AlertRuleDto["metric"];

export const METRICS: ReadonlyArray<{ value: AlertMetric; label: string; unit: string; hint: string }> = [
  { value: "error_rate", get label() { return t("alertFmt.metric.error_rate"); }, unit: "%", get hint() { return t("alertFmt.hint.error_rate"); } },
  { value: "latency_p95", get label() { return t("alertFmt.metric.latency_p95"); }, unit: "ms", get hint() { return t("alertFmt.hint.latency_p95"); } },
  { value: "cost", get label() { return t("alertFmt.metric.cost"); }, unit: "USD", get hint() { return t("alertFmt.hint.cost"); } },
  { value: "satisfaction", get label() { return t("alertFmt.metric.satisfaction"); }, unit: "%", get hint() { return t("alertFmt.hint.satisfaction"); } },
  { value: "custom", get label() { return t("alertFmt.metric.custom"); }, unit: "", get hint() { return t("alertFmt.hint.custom"); } },
];

export const WINDOWS: ReadonlyArray<{ value: number; label: string }> = [5, 15, 30, 60, 180, 360, 1440].map((value) => ({
  value,
  get label() {
    return windowText(value, true);
  },
}));

export const REMINDERS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, get label() { return t("alertFmt.remind.never"); } },
  { value: 15, get label() { return t("alertFmt.remind.15"); } },
  { value: 60, get label() { return t("alertFmt.remind.60"); } },
  { value: 360, get label() { return t("alertFmt.remind.360"); } },
  { value: 1440, get label() { return t("alertFmt.remind.1440"); } },
];

export const metricLabel = (metric: AlertMetric): string => METRICS.find((m) => m.value === metric)?.label ?? metric;
export const metricUnit = (metric: AlertMetric): string => METRICS.find((m) => m.value === metric)?.unit ?? "";
/** Las métricas cuyo valor solo es fiable con un mínimo de trazas o de votos. */
export const needsSamples = (metric: AlertMetric): boolean => metric === "error_rate" || metric === "latency_p95" || metric === "satisfaction";
export const samplesLabel = (metric: AlertMetric): string => (metric === "satisfaction" ? t("alertFmt.votes") : t("alertFmt.conversations"));

/** «15 min», «1 hour», «6 hours»; con `long`, también los minutos con todas las letras («15 minutes»). */
export function windowText(minutes: number, long = false): string {
  if (minutes >= 60 && minutes % 60 === 0) return tp("alertFmt.hours", minutes / 60);
  return long ? tp("alertFmt.minutes", minutes) : t("alertFmt.min", { n: minutes });
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
  const subject = rule.metric === "custom" ? (chartName ?? t("alertFmt.metric.custom")) : metricLabel(rule.metric);
  return `${subject} ${t(rule.comparator === "above" ? "alertFmt.above" : "alertFmt.below")} ${formatValue(rule.metric, rule.threshold)}`;
}

/** La condición de una regla en una frase: «Error rate above 5 % over 15 min». */
export function conditionText(rule: Pick<AlertRuleDto, "metric" | "comparator" | "threshold" | "windowMinutes">, chartName?: string | null): string {
  return t("alertFmt.condition", { phrase: thresholdPhrase(rule, chartName), window: windowText(rule.windowMinutes) });
}

export type StateTone = "ok" | "error" | "warn" | "neutral";

/** El estado que se enseña de una regla: lo que ha dicho el evaluador, o por qué no hay nada que decir. */
export function stateOf(rule: Pick<AlertRuleDto, "enabled" | "metric" | "customMetricId">, status: AlertStatusDto | null): { label: string; tone: StateTone } {
  if (!rule.enabled) return { label: t("alertFmt.state.paused"), tone: "neutral" };
  if (rule.metric === "custom" && rule.customMetricId === null) return { label: t("alertFmt.state.chartDeleted"), tone: "warn" };
  if (!status) return { label: t("alertFmt.state.waiting"), tone: "neutral" };
  if (status.state === "firing") return { label: t("alertFmt.state.firing"), tone: "error" };
  if (status.state === "no_data") return { label: t("alertFmt.state.noData"), tone: "warn" };
  return { label: t("alertFmt.state.ok"), tone: "ok" };
}

export const EVENT_LABEL: Record<AlertEventDto["kind"], { label: string; tone: StateTone }> = {
  fired: { get label() { return t("alertFmt.event.fired"); }, tone: "error" },
  reminder: { get label() { return t("alertFmt.event.reminder"); }, tone: "warn" },
  resolved: { get label() { return t("alertFmt.event.resolved"); }, tone: "ok" },
};

/** Cuánta gente recibió el aviso, en una frase corta para el historial. */
export function emailedText(emailed: number, recipients: number | null): string {
  if (emailed === 0) return recipients === 0 ? t("alertFmt.noRecipients") : t("alertFmt.notEmailed");
  return tp("alertFmt.emails", emailed);
}

/** Direcciones escritas separadas por comas, punto y coma, espacios o líneas. */
export function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «Your limit is» / «Your minimum is»: el límite según se vigile por arriba o por abajo. */
const limitWord = (comparator: "above" | "below") => (comparator === "above" ? t("alertFmt.limit") : t("alertFmt.minimum"));

/** La alerta que sigue disparada, como la cuenta la campana (ADR-094): «Latency (p95) is 2,807 ms. Your limit is 5 ms.» y cuánto lleva así. */
export function openAlertView(a: Pick<OpenAlertDto, "metric" | "comparator" | "lastValue" | "threshold" | "windowMinutes">): { text: string; detail: string } {
  const subject = a.metric === "custom" ? t("alertFmt.metric.custom") : metricLabel(a.metric);
  return {
    text: t("alertFmt.openText", { subject, value: formatValue(a.metric, a.lastValue), word: limitWord(a.comparator), limit: formatValue(a.metric, a.threshold) }),
    detail: overFor(a.comparator, a.windowMinutes),
  };
}

const overFor = (comparator: "above" | "below", minutes: number) =>
  t(comparator === "above" ? "alertFmt.overFor" : "alertFmt.underFor", { window: windowText(minutes) });

/** Cómo se cuenta un aviso de la campana (ADR-094): el titular, la frase con el valor, el detalle que va tras el agente y el tono. */
export function notificationView(
  n: Pick<NotificationDto, "kind" | "ruleName" | "metric" | "comparator" | "value" | "threshold" | "budgetUsd" | "warnPercent" | "windowMinutes" | "spentUsd">,
): { title: string; text: string; detail: string; tone: StateTone; cta: string } {
  const budget = n.budgetUsd === null ? null : formatValue("cost", n.budgetUsd);
  const gone = t("alertFmt.budgetGone");
  // el gasto exacto solo está en los avisos que se guardaron con él; en los anteriores, una frase sin cifra
  const spent = (fallback: string) => (budget === null ? gone : n.spentUsd === null ? fallback : t("alertFmt.spent", { spent: formatValue("cost", n.spentUsd), budget }));
  const estimate = n.spentUsd === null ? "" : t("alertFmt.estimate");
  const cta = t("alertFmt.seeCosts");
  if (n.kind === "budget_warning") {
    const title = n.warnPercent === null ? t("alertFmt.budgetWarningNoPct") : t("alertFmt.budgetWarning", { pct: n.warnPercent });
    return { title, text: spent(t("alertFmt.filling", { budget: budget ?? "" })), detail: estimate, tone: "warn", cta };
  }
  if (n.kind === "budget_exceeded") return { title: t("alertFmt.budgetExceeded"), text: spent(t("alertFmt.wentOver", { budget: budget ?? "" })), detail: estimate, tone: "error", cta };
  if (n.kind === "budget_forecast") return { title: t("alertFmt.forecastTitle"), text: budget === null ? gone : t("alertFmt.forecast", { budget }), detail: "", tone: "warn", cta };
  const name = n.ruleName ?? t("alertFmt.anAlert");
  const metric = n.metric ?? "custom";
  const comparator = n.comparator ?? "above";
  const subject = metric === "custom" ? t("alertFmt.metric.custom") : metricLabel(metric);
  const limit = n.threshold === null ? "" : formatValue(metric, n.threshold);
  const value = formatValue(metric, n.value);
  const view = t("alertFmt.viewAlert");
  if (n.kind === "resolved") {
    const text = !limit
      ? t("alertFmt.nowValue", { subject, value })
      : t(comparator === "above" ? "alertFmt.droppedUnder" : "alertFmt.roseOver", { subject, value, limit });
    return { title: t("alertFmt.backToNormal", { name }), text, detail: "", tone: "ok", cta: view };
  }
  const detail = n.windowMinutes === null ? "" : overFor(comparator, n.windowMinutes);
  const text = limit ? t("alertFmt.openText", { subject, value, word: limitWord(comparator), limit }) : t("alertFmt.isValue", { subject, value });
  return { title: name, text, detail, tone: "error", cta: view };
}

/** «5 min ago» dentro de la última hora, «3 h ago» el mismo día, «Yesterday» el día anterior y «N d ago» más atrás. */
export function bellTime(iso: string, nowMs: number): string {
  const then = new Date(iso);
  const now = new Date(nowMs);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days === 1 && nowMs - then.getTime() >= 3_600_000) return t("time.yesterday");
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
