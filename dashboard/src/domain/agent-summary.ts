import type { AgentSecurityDto, AlertsOverviewDto, DeployRunDto, ErrorOverviewResponse, OverviewResponse, RunListItemDto } from "@contract";
import { tr } from "./translate";

/** Fewer executions than this say little about a percentage (same threshold as Overview › Summary). */
const SMALL_SAMPLE = 20;
/** Share of failed executions above which a healthy agent is flagged. */
const WARN_ERROR_RATE = 0.05;
const MAX_EVENTS = 6;
const MAX_CAUSES = 3;

export type SummaryTone = "ok" | "warn" | "error" | "neutral";

/** One period for the whole summary. `month` is the current calendar month (UTC) so far; the others roll back from now. */
export type SummaryPeriod = "month" | "7d" | "30d" | "90d";
export const SUMMARY_PERIODS: SummaryPeriod[] = ["month", "7d", "30d", "90d"];
export const DEFAULT_PERIOD: SummaryPeriod = "month";

const DAY_MS = 86_400_000;

export interface PeriodRange {
  key: SummaryPeriod;
  from: Date;
  to: Date;
  /** the span right before, to compare with: same length (rolling) or the same elapsed days of the previous month */
  previousFrom: Date;
  previousTo: Date;
  /** whole days the period covers, at least 1 (security events are counted per day) */
  days: number;
}

export function periodRange(key: SummaryPeriod, now: Date = new Date()): PeriodRange {
  if (key === "month") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const previousFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const elapsed = now.getTime() - from.getTime();
    return { key, from, to: now, previousFrom, previousTo: new Date(previousFrom.getTime() + elapsed), days: Math.max(1, Math.ceil(elapsed / DAY_MS)) };
  }
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  const from = new Date(now.getTime() - days * DAY_MS);
  return { key, from, to: now, previousFrom: new Date(from.getTime() - days * DAY_MS), previousTo: from, days };
}

/** Every part is optional: the person may lack the permission for one of them, or it may have failed to load. */
export interface AgentSummaryInput {
  period: PeriodRange;
  overview: OverviewResponse | null;
  /** the same figures for the span before the period; null if it could not be read */
  previousOverview: OverviewResponse | null;
  /** detections in the span before the period; null if it could not be read */
  previousSecurityEvents: number | null;
  /** the alerts are the state right now, not a period */
  alerts: AlertsOverviewDto | null;
  security: AgentSecurityDto | null;
  errors: ErrorOverviewResponse | null;
  /** newest first */
  runs: RunListItemDto[] | null;
  deploys: DeployRunDto[] | null;
  /** deployment id → name of its environment */
  environmentOf: Record<string, string>;
}

export interface SummaryHealth {
  tone: SummaryTone;
  title: string;
  text: string;
}

export type SummaryCardId = "reliability" | "cost" | "quality" | "security" | "alerts";

export interface SummaryCard {
  id: SummaryCardId;
  label: string;
  value: string;
  sub: string;
  tone: SummaryTone;
  /** change against the previous period; null when there is nothing to compare */
  delta: { text: string; tone: SummaryTone } | null;
}

export interface SummaryEvent {
  id: string;
  at: string;
  kind: "alert" | "resolved" | "deploy" | "evaluation";
  tone: SummaryTone;
  title: string;
  text: string;
}

export interface SummaryCause {
  id: string;
  title: string;
  occurrences: number;
  /** 0-100, over every failure of the period */
  share: number;
  trend: "new" | "up" | "down" | "flat";
}

export interface AgentSummary {
  health: SummaryHealth | null;
  cards: SummaryCard[];
  events: SummaryEvent[];
  causes: SummaryCause[];
}

const pct = (fraction: number, digits = 1): string => `${(fraction * 100).toFixed(digits)}%`;
const usd = (value: number): string => `$${value.toFixed(value >= 100 ? 0 : 2)}`;
const shortSha = (sha: string): string => sha.slice(0, 7);

/** "▲ 2.1 pp vs previous period"; the tone says whether the change is good, bad or just a change. */
function compare(diff: number, text: string, goodWhen: "up" | "down" | "none", epsilon: number): SummaryCard["delta"] {
  if (Math.abs(diff) < epsilon) return { text: tr("agentSummary.delta_same"), tone: "neutral" };
  const up = diff > 0;
  const tone: SummaryTone = goodWhen === "none" ? "neutral" : up === (goodWhen === "up") ? "ok" : "error";
  return { text: tr("agentSummary.delta_vs", { arrow: up ? "▲" : "▼", value: text }), tone };
}

const firingRules = (alerts: AlertsOverviewDto | null) => (alerts?.rules ?? []).filter((r) => r.status?.state === "firing");

function health(input: AgentSummaryInput): SummaryHealth | null {
  const o = input.overview;
  if (!o) return null;
  const total = o.totals.traces;
  if (total === 0) return { tone: "neutral", title: tr("agentSummary.health_empty_title"), text: tr("agentSummary.health_empty_text", { period: tr(`agentSummary.phrase_${input.period.key}`) }) };
  const firing = firingRules(input.alerts);
  const failed = o.totals.errorTraces;
  const text = tr("agentSummary.health_text", { ok: pct(1 - o.totals.errorRate), total, period: tr(`agentSummary.phrase_${input.period.key}`) });
  if (firing.length > 0) {
    return { tone: "error", title: tr("agentSummary.health_alerts_title"), text: `${text} ${tr("agentSummary.health_alerts_text", { names: firing.map((r) => r.rule.name).join(", ") })}` };
  }
  if (total < SMALL_SAMPLE) return { tone: "neutral", title: tr("agentSummary.health_small_title"), text };
  if (o.totals.errorRate > WARN_ERROR_RATE) return { tone: "warn", title: tr("agentSummary.health_failing_title"), text: `${text} ${tr("agentSummary.health_failed", { failed })}` };
  return { tone: "ok", title: tr("agentSummary.health_ok_title"), text };
}

function reliabilityCard(input: AgentSummaryInput): SummaryCard | null {
  const o = input.overview;
  if (!o) return null;
  const failing = firingRules(input.alerts).some((r) => r.rule.metric === "error_rate");
  const none = o.totals.traces === 0;
  const p = input.previousOverview;
  const change = !none && p && p.totals.traces > 0 ? compare(((1 - o.totals.errorRate) - (1 - p.totals.errorRate)) * 100, `${Math.abs(((1 - o.totals.errorRate) - (1 - p.totals.errorRate)) * 100).toFixed(1)} pp`, "up", 0.1) : null;
  return {
    id: "reliability",
    label: tr("agentSummary.reliability"),
    value: none ? "–" : pct(1 - o.totals.errorRate),
    sub: none ? tr("agentSummary.no_executions") : tr("agentSummary.failed_of", { failed: o.totals.errorTraces, total: o.totals.traces }),
    tone: none ? "neutral" : failing || o.totals.errorRate > WARN_ERROR_RATE ? "error" : "ok",
    delta: change,
  };
}

function costCard(input: AgentSummaryInput): SummaryCard | null {
  const a = input.alerts;
  const o = input.overview;
  const month = input.period.key === "month";
  // the budget and the forecast only make sense for the month being lived; any other period is plain spend
  const spent = o ? o.totals.costUsd : month && a ? a.monthCost.spentUsd : null;
  if (spent === null) return null;
  const forecast = month && a ? a.monthCost.projectedUsd : null;
  const b = month && a ? a.budget : null;
  let sub = forecast !== null ? tr("agentSummary.forecast", { amount: usd(forecast) }) : "";
  let tone: SummaryTone = "neutral";
  if (b?.budget.enabled) {
    sub = tr("agentSummary.of_budget", { percent: Math.round(b.percent), budget: usd(b.budget.monthlyUsd) }) + (forecast !== null ? ` · ${tr("agentSummary.forecast", { amount: usd(forecast) })}` : "");
    tone = b.percent >= 100 ? "error" : b.percent >= b.budget.warnPercent ? "warn" : "ok";
  }
  const before = input.previousOverview?.totals.costUsd ?? null;
  const change = o && before !== null && before > 0 ? compare(spent - before, `${Math.abs(((spent - before) / before) * 100).toFixed(0)}%`, "none", 0.005) : null;
  return { id: "cost", label: tr("agentSummary.cost"), value: usd(spent), sub, tone, delta: change };
}

/** Mean of the pass rates of the boolean evaluators of a run; falls back to nothing if it only has numeric ones. */
export function runScore(run: RunListItemDto): number | null {
  const rates = run.aggregates.flatMap((a) => (a.dataType === "boolean" && a.passRate !== null ? [a.passRate] : []));
  return rates.length > 0 ? rates.reduce((x, y) => x + y, 0) / rates.length : null;
}

function qualityCard(input: AgentSummaryInput): SummaryCard | null {
  if (!input.runs) return null;
  const from = input.period.from.getTime();
  const run = input.runs.find((r) => r.status === "completed" && runScore(r) !== null && Date.parse(r.createdAt) >= from);
  if (!run) return { id: "quality", label: tr("agentSummary.quality"), value: "–", sub: tr("agentSummary.no_evaluation"), tone: "neutral", delta: null };
  const score = runScore(run)!;
  const previous = input.runs.find((r) => r !== run && r.datasetId === run.datasetId && r.status === "completed" && runScore(r) !== null);
  const delta = previous ? score - runScore(previous)! : null;
  const change = delta === null ? null : compare(delta * 100, `${Math.abs(delta * 100).toFixed(1)} pt`, "up", 0.1);
  return { id: "quality", label: tr("agentSummary.quality"), value: pct(score, 0), sub: run.name, tone: delta !== null && delta < -0.02 ? "warn" : "neutral", delta: change };
}

function securityCard(input: AgentSummaryInput): SummaryCard | null {
  const s = input.security;
  if (!s) return null;
  const before = input.previousSecurityEvents;
  return {
    id: "security",
    label: tr("agentSummary.security"),
    value: String(s.events.total),
    sub: tr("agentSummary.blocked_in", { blocked: s.events.blocked }),
    tone: s.events.blocked > 0 ? "warn" : "neutral",
    delta: before === null ? null : compare(s.events.total - before, String(Math.abs(s.events.total - before)), "down", 1),
  };
}

function alertsCard(input: AgentSummaryInput): SummaryCard | null {
  const a = input.alerts;
  if (!a) return null;
  const firing = firingRules(a);
  if (firing.length === 0) return { id: "alerts", label: tr("agentSummary.alerts"), value: tr("agentSummary.none_firing"), sub: tr(a.rules.length === 1 ? "agentSummary.rules_count.one" : "agentSummary.rules_count.other", { count: a.rules.length }), tone: a.rules.length > 0 ? "ok" : "neutral", delta: null };
  return { id: "alerts", label: tr("agentSummary.alerts"), value: tr("agentSummary.n_firing", { count: firing.length }), sub: firing[0]!.rule.name, tone: "error", delta: null };
}

function events(input: AgentSummaryInput): SummaryEvent[] {
  const since = input.period.from.getTime();
  const out: SummaryEvent[] = [];
  const names = new Map((input.alerts?.rules ?? []).map((r) => [r.rule.id, r.rule.name]));
  for (const e of input.alerts?.events ?? []) {
    if (e.kind === "reminder") continue;
    const name = names.get(e.ruleId) ?? tr("agentSummary.deleted_rule");
    out.push(
      e.kind === "fired"
        ? { id: `alert-${e.id}`, at: e.at, kind: "alert", tone: "error", title: tr("agentSummary.event_fired", { name }), text: tr("agentSummary.event_fired_text", { value: Number(e.value.toFixed(2)), threshold: e.threshold }) }
        : { id: `alert-${e.id}`, at: e.at, kind: "resolved", tone: "ok", title: tr("agentSummary.event_resolved", { name }), text: "" },
    );
  }
  for (const d of input.deploys ?? []) {
    if (d.status !== "succeeded" && d.status !== "failed") continue;
    const env = input.environmentOf[d.deploymentId] ?? "";
    out.push({
      id: `deploy-${d.id}`,
      at: d.finishedAt ?? d.createdAt,
      kind: "deploy",
      tone: d.status === "failed" ? "error" : "neutral",
      title: tr(d.status === "failed" ? "agentSummary.event_deploy_failed" : "agentSummary.event_deploy", { sha: shortSha(d.commitSha), env }),
      text: d.gateBypassed ? tr("agentSummary.event_gate_bypassed") : "",
    });
  }
  for (const r of input.runs ?? []) {
    if (r.status !== "completed") continue;
    const score = runScore(r);
    out.push({ id: `run-${r.id}`, at: r.createdAt, kind: "evaluation", tone: "neutral", title: tr("agentSummary.event_run", { name: r.name }), text: score === null ? tr("agentSummary.event_run_items", { count: r.itemCount }) : tr("agentSummary.event_run_score", { score: pct(score, 0), count: r.itemCount }) });
  }
  return out
    .filter((e) => Date.parse(e.at) >= since)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_EVENTS);
}

function causes(input: AgentSummaryInput): SummaryCause[] {
  const e = input.errors;
  if (!e || e.totals.occurrences === 0) return [];
  return e.categories.slice(0, MAX_CAUSES).map((c) => ({
    id: c.id,
    title: c.title,
    occurrences: c.occurrences,
    share: Math.round((c.occurrences / e.totals.occurrences) * 100),
    trend: trendOf(c.occurrences, c.previousOccurrences, e.previousRange !== null),
  }));
}

/** Compared with the previous period; without one (outside the retention) there is nothing to compare. */
function trendOf(now: number, before: number, hasPrevious: boolean): SummaryCause["trend"] {
  if (!hasPrevious) return "flat";
  if (before === 0) return "new";
  if (now > before * 1.1) return "up";
  if (now < before * 0.9) return "down";
  return "flat";
}

/** Everything the agent page summary shows, from the already-loaded DTOs. No model call: fixed rules only. */
export function buildAgentSummary(input: AgentSummaryInput): AgentSummary {
  const cards = [reliabilityCard(input), costCard(input), qualityCard(input), securityCard(input), alertsCard(input)].filter((c): c is SummaryCard => c !== null);
  return { health: health(input), cards, events: events(input), causes: causes(input) };
}
