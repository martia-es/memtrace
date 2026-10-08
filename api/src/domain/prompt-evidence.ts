import { summarizeErrors, type ErrorGroup, type ErrorSeverity } from "./error-categories";
import { costOf, type PricingCatalog } from "./pricing";
import type { TimeRange } from "./time-range";

/**
 * Evidencia por versión de un prompt (ADR-069): qué pasó en las trazas que usaron cada versión. Tipos y reglas puras:
 * el repositorio entrega filas agregadas por versión y aquí se convierten en cifras de negocio. Sin tecnología.
 */

/** Una fila por versión: las trazas que tienen algún span marcado con ese prompt y esa versión. */
export interface VersionTraceRow {
  version: number;
  traces: number;
  conversations: number;
  /** trazas con algún span fallido */
  errorTraces: number;
  p50Ms: number;
  p95Ms: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface VersionTokenRow {
  version: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** Spans fallidos más profundos de las trazas de una versión, con la forma de `ErrorGroup` (ADR-066). */
export interface VersionErrorGroup extends ErrorGroup {
  version: number;
}

export interface VersionFeedbackRow {
  version: number;
  up: number;
  down: number;
  ratedTraces: number;
}

/** Resultado de un evaluador sobre los items de evaluación cuyas trazas usaron la versión. */
export interface VersionEvaluatorRow {
  version: number;
  name: string;
  dataType: string;
  /** items puntuados */
  items: number;
  /** media de `ValueNum`: tasa de aprobados en un booleano, media en un numérico; null en un categórico */
  average: number | null;
}

export interface PromptEvidenceRows {
  traces: VersionTraceRow[];
  tokens: VersionTokenRow[];
  errors: VersionErrorGroup[];
  feedback: VersionFeedbackRow[];
  evaluators: VersionEvaluatorRow[];
}

export interface ErrorCause {
  id: string;
  title: string;
  severity: ErrorSeverity;
  traces: number;
}

export interface EvaluatorEvidence {
  name: string;
  dataType: "boolean" | "numeric" | "categorical" | string;
  items: number;
  /** boolean: tasa de aprobados (0-1); numeric: media; categorical: null */
  value: number | null;
}

export interface VersionEvidence {
  version: number;
  traces: number;
  conversations: number;
  errorTraces: number;
  /** 0-1 */
  errorRate: number;
  latencyMs: { p50: number; p95: number };
  inputTokens: number;
  outputTokens: number;
  /** null si ningún modelo usado tiene precio conocido (ADR-025) */
  costUsd: number | null;
  /** coste medio por traza; null con la misma condición */
  costPerTraceUsd: number | null;
  /** false: algún modelo usado no tiene precio, así que el coste es un mínimo */
  costComplete: boolean;
  feedback: { up: number; down: number; ratedTraces: number; satisfaction: number | null };
  evaluators: EvaluatorEvidence[];
  /** causas de error de negocio (ADR-066), las más graves primero */
  errorCauses: ErrorCause[];
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface PromptEvidence {
  range: TimeRange;
  /** más reciente primero */
  versions: VersionEvidence[];
}

const MAX_CAUSES = 3;

/** Agrupa las filas del repositorio por versión y las convierte en cifras: coste con el catálogo de precios, causas de error en lenguaje de negocio. */
export function buildPromptEvidence(rows: PromptEvidenceRows, pricing: PricingCatalog, range: TimeRange): PromptEvidence {
  const versions = rows.traces
    .map((t) => buildVersion(t, rows, pricing, range))
    .sort((a, b) => b.version - a.version);
  return { range, versions };
}

function buildVersion(t: VersionTraceRow, rows: PromptEvidenceRows, pricing: PricingCatalog, range: TimeRange): VersionEvidence {
  const tokens = rows.tokens.filter((x) => x.version === t.version);
  const inputTokens = tokens.reduce((n, x) => n + x.inputTokens, 0);
  const outputTokens = tokens.reduce((n, x) => n + x.outputTokens, 0);
  const costs = tokens.map((x) => costOf(x.model, x.inputTokens, x.outputTokens, pricing));
  const priced = costs.filter((c): c is number => c !== null);
  const costUsd = priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null;

  const vote = rows.feedback.find((f) => f.version === t.version);
  const votes = vote ? vote.up + vote.down : 0;

  const groups = rows.errors.filter((g) => g.version === t.version);
  const causes = summarizeErrors(
    { groups, tracesWithErrors: t.errorTraces, conversationsWithErrors: 0, totalTraces: t.traces, totalConversations: t.conversations },
    null,
    range,
    null,
  ).categories
    .slice(0, MAX_CAUSES)
    .map<ErrorCause>((c) => ({ id: c.id, title: c.title, severity: c.severity, traces: c.traces }));

  return {
    version: t.version,
    traces: t.traces,
    conversations: t.conversations,
    errorTraces: t.errorTraces,
    errorRate: t.traces > 0 ? t.errorTraces / t.traces : 0,
    latencyMs: { p50: t.p50Ms, p95: t.p95Ms },
    inputTokens,
    outputTokens,
    costUsd,
    costPerTraceUsd: costUsd !== null && t.traces > 0 ? costUsd / t.traces : null,
    costComplete: costs.every((c) => c !== null),
    feedback: { up: vote?.up ?? 0, down: vote?.down ?? 0, ratedTraces: vote?.ratedTraces ?? 0, satisfaction: votes > 0 ? (vote!.up / votes) * 100 : null },
    evaluators: rows.evaluators
      .filter((e) => e.version === t.version)
      .map<EvaluatorEvidence>((e) => ({ name: e.name, dataType: e.dataType, items: e.items, value: e.average }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    errorCauses: causes,
    firstSeenMs: t.firstSeenMs,
    lastSeenMs: t.lastSeenMs,
  };
}
