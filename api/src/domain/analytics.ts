import { costOf, type PricingCatalog } from "./pricing";
import type { TimeRange } from "./time-range";

/**
 * Cómo se agrupan las trazas en Overview › Analytics. `user` llega con el atributo de usuario final del SDK (pendiente).
 * Dos filas de grupos distintos no son siempre comparables (cada agente hace cosas distintas); las vistas de entorno y de
 * versión sí lo son a propósito: un entorno corre otra versión para ver la mejora antes de promoverla.
 */
export const ANALYTICS_GROUPS = ["prompt_version", "environment"] as const;
export type AnalyticsGroup = (typeof ANALYTICS_GROUPS)[number];

/** Días de la serie de errores de cada fila. */
export const TREND_DAYS = 7;
const DAY_MS = 86_400_000;
/** z de un intervalo del 95 %. */
const Z95 = 1.96;

export interface AnalyticsGroupRow {
  key: string;
  traces: number;
  errorTraces: number;
  p95Ms: number | null;
  /** lo que se ve en esa fila: los entornos donde corrió una versión, o las versiones que corrieron en un entorno */
  related: string[];
  up: number;
  down: number;
}
export interface AnalyticsTokenRow {
  key: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}
export interface AnalyticsDayRow {
  key: string;
  /** inicio del día, en ms */
  dayMs: number;
  traces: number;
  errorTraces: number;
}
export interface AnalyticsRows {
  groups: AnalyticsGroupRow[];
  tokens: AnalyticsTokenRow[];
  days: AnalyticsDayRow[];
}

export interface AnalyticsTrendPoint {
  dayMs: number;
  traces: number;
  errorTraces: number;
}
export interface AnalyticsItem {
  key: string;
  related: string[];
  traces: number;
  errorTraces: number;
  errorRate: number;
  /** semiancho del intervalo del 95 % de la tasa de error (0..1): si dos intervalos se solapan, la diferencia puede ser ruido */
  errorMargin: number;
  p95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  /** null si ningún modelo de la fila tiene precio en el catálogo */
  costUsd: number | null;
  costPerTraceUsd: number | null;
  /** false: algún modelo usado no tiene precio, así que `costUsd` es un mínimo */
  costComplete: boolean;
  /** 👍 sobre las trazas con valoración; null sin valoraciones */
  thumbsUpRate: number | null;
  ratedTraces: number;
  trend: AnalyticsTrendPoint[];
}
export interface Analytics {
  groupBy: AnalyticsGroup;
  range: TimeRange;
  items: AnalyticsItem[];
  /** tokens de modelos sin precio en el catálogo: lo que falta en el coste en vez de subestimarlo en silencio */
  unpricedTokens: number;
}

/** Semiancho del intervalo de Wilson de una proporción: se comporta con pocas trazas y tasas cerca de 0 o 1, donde la normal falla. */
export function wilsonMargin(successes: number, n: number): number {
  if (n <= 0) return 0;
  const p = successes / n;
  const z2 = Z95 * Z95;
  return (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Los últimos `TREND_DAYS` días (UTC) que acaban en el rango, rellenos con ceros donde no hubo tráfico. */
function trendOf(rows: AnalyticsDayRow[], toMs: number): AnalyticsTrendPoint[] {
  const last = Math.floor(toMs / DAY_MS) * DAY_MS;
  const byDay = new Map(rows.map((r) => [r.dayMs, r]));
  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const dayMs = last - (TREND_DAYS - 1 - i) * DAY_MS;
    const r = byDay.get(dayMs);
    return { dayMs, traces: r?.traces ?? 0, errorTraces: r?.errorTraces ?? 0 };
  });
}

/** Pone precio a los tokens y calcula tasas y márgenes. Las filas van de más a menos trazas. */
export function buildAnalytics(groupBy: AnalyticsGroup, rows: AnalyticsRows, pricing: PricingCatalog, range: TimeRange): Analytics {
  const tokensByKey = new Map<string, AnalyticsTokenRow[]>();
  for (const t of rows.tokens) tokensByKey.set(t.key, [...(tokensByKey.get(t.key) ?? []), t]);
  const daysByKey = new Map<string, AnalyticsDayRow[]>();
  for (const d of rows.days) daysByKey.set(d.key, [...(daysByKey.get(d.key) ?? []), d]);

  let unpricedTokens = 0;
  const items = rows.groups.map((g): AnalyticsItem => {
    const tokens = tokensByKey.get(g.key) ?? [];
    const costs = tokens.map((t) => costOf(t.model, t.inputTokens, t.outputTokens, pricing));
    tokens.forEach((t, i) => {
      if (costs[i] === null) unpricedTokens += t.inputTokens + t.outputTokens;
    });
    const priced = costs.filter((c): c is number => c !== null);
    const costUsd = priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null;
    const rated = g.up + g.down;
    return {
      key: g.key,
      related: g.related,
      traces: g.traces,
      errorTraces: g.errorTraces,
      errorRate: g.traces > 0 ? g.errorTraces / g.traces : 0,
      errorMargin: wilsonMargin(g.errorTraces, g.traces),
      p95Ms: g.p95Ms,
      inputTokens: tokens.reduce((a, t) => a + t.inputTokens, 0),
      outputTokens: tokens.reduce((a, t) => a + t.outputTokens, 0),
      costUsd,
      costPerTraceUsd: costUsd !== null && g.traces > 0 ? costUsd / g.traces : null,
      costComplete: costs.every((c) => c !== null),
      thumbsUpRate: rated > 0 ? g.up / rated : null,
      ratedTraces: rated,
      trend: trendOf(daysByKey.get(g.key) ?? [], range.toMs),
    };
  });
  items.sort((a, b) => b.traces - a.traces || a.key.localeCompare(b.key));
  return { groupBy, range, items, unpricedTokens };
}
