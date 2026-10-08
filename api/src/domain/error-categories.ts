/**
 * Errores en lenguaje de negocio, sin IA (ADR-066): un catálogo ordenado de reglas deterministas
 * traduce la señal técnica de un span fallido (mensaje, tipo de excepción, status HTTP, tipo de paso)
 * a una categoría con título, explicación y acción sugerida. Lo que ninguna regla reconoce cae en
 * "other" y se agrupa por huella del mensaje normalizado.
 */
import type { TimeRange } from "./time-range";

/** Un grupo de spans fallidos con la misma señal técnica, tal como lo agrega el almacén. */
export interface ErrorGroup {
  /** tipo de paso: `tool`, `llm`, un step type custom… */
  kind: string;
  /** nombre de la herramienta o del span */
  name: string;
  message: string;
  /** `exception.type` del evento de excepción; vacío si no hay */
  exceptionType: string;
  /** `exception.message`: la causa real cuando el SDK no rellena el mensaje de estado (p. ej. reintentos de tool) */
  exceptionMessage: string;
  occurrences: number;
  traces: number;
  conversations: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface ErrorGroupsResult {
  groups: ErrorGroup[];
  /** trazas / conversaciones con algún span fallido (exactas, sin solaparse entre grupos) */
  tracesWithErrors: number;
  conversationsWithErrors: number;
  totalTraces: number;
  totalConversations: number;
}

export type ErrorSeverity = "high" | "medium" | "low";

export interface ErrorSignal {
  kind: string;
  message: string;
  exceptionType: string;
  exceptionMessage?: string;
}

export interface ErrorCategoryDef {
  id: string;
  title: string;
  /** qué ha pasado, en lenguaje llano */
  explanation: string;
  /** qué hacer y a quién avisar */
  action: string;
  severity: ErrorSeverity;
}

interface Rule extends ErrorCategoryDef {
  matches: (s: ErrorSignal, text: string, httpStatus: number | null) => boolean;
}

const HTTP_STATUS_PATTERNS = [
  /\b(?:status(?:[_ ]code)?|http|code|error)[\s:=_-]{0,3}(\d{3})\b/i,
  /\b(\d{3})\s+(?:too many|unauthori[sz]ed|forbidden|not found|internal|bad|service|gateway|client error|server error|request)/i,
];

/** Primer status HTTP (100-599) citado de forma explícita en el mensaje; null si no hay. */
export function extractHttpStatus(message: string): number | null {
  for (const pattern of HTTP_STATUS_PATTERNS) {
    const code = Number(pattern.exec(message)?.[1]);
    if (code >= 100 && code <= 599) return code;
  }
  return null;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** Orden = prioridad: la primera regla que casa gana (cuota antes que cualquier 4xx, timeout antes que 5xx…). */
const RULES: Rule[] = [
  {
    id: "quota_exceeded",
    title: "AI provider usage limit reached",
    explanation: "The AI provider rejected requests because the quota or rate limit was exceeded, so some answers could not be generated.",
    action: "Ask the platform team to raise the quota or add a fallback model.",
    severity: "high",
    matches: (_s, t, http) => http === 429 || has(t, /rate.?limit|quota|resource.?exhausted|too many requests|usage limit|insufficient_quota/),
  },
  {
    id: "context_too_long",
    title: "Conversation too long for the model",
    explanation: "The conversation (or a document in it) was longer than the model can read.",
    action: "Ask the technical team to shorten or summarise the context.",
    severity: "medium",
    matches: (_s, t) => has(t, /context.{0,12}(length|window)|maximum context|too many tokens|token limit|prompt is too long|max_tokens/),
  },
  {
    id: "safety_blocked",
    title: "Answer blocked by safety filters",
    explanation: "The AI provider's safety filters blocked the request or the answer.",
    action: "Review the affected conversations; the content may need a different phrasing or policy.",
    severity: "medium",
    matches: (_s, t) => has(t, /safety|content.?filter|content_policy|blocked (?:by|due)|harm_category|responsible ai/),
  },
  {
    id: "timeout",
    title: "A service took too long to respond",
    explanation: "A tool or the AI provider did not answer in time, so the step was abandoned.",
    action: "Usually temporary. If it keeps growing, ask the owner of that service to check its performance.",
    severity: "medium",
    matches: (s, t, http) => http === 408 || http === 504 || has(`${s.exceptionType} ${t}`, /time.?out|timed out|deadline.?exceeded|etimedout/),
  },
  {
    id: "service_unavailable",
    title: "An external service was unavailable",
    explanation: "A tool, API or the AI provider was down or failed internally, so the step could not be completed.",
    action: "Check the status of that service; if it is internal, notify its owner.",
    severity: "high",
    matches: (_s, t, http) =>
      (http !== null && http >= 500) || has(t, /service unavailable|high demand|bad gateway|internal server error|connection (?:refused|reset|error|aborted)|econn|unreachable|name resolution|dns|network error|overloaded|temporarily unavailable/),
  },
  {
    id: "access_denied",
    title: "Access or credentials problem",
    explanation: "A tool or the AI provider refused access: an API key or permission is missing, expired or wrong.",
    action: "Ask the platform team to check the credentials of that integration.",
    severity: "high",
    matches: (_s, t, http) => http === 401 || http === 403 || has(t, /unauthori[sz]ed|forbidden|permission denied|invalid api key|api key|credential|authentication|access denied/),
  },
  {
    id: "not_found",
    title: "Requested information was not found",
    explanation: "The assistant asked a tool for something that does not exist (a record, a file, an address).",
    action: "Often expected. Review it only if it grows or affects many conversations.",
    severity: "low",
    matches: (_s, t, http) => http === 404 || has(t, /not found|does not exist|no such|no results/),
  },
  {
    id: "invalid_request",
    title: "The assistant sent an invalid request",
    explanation: "A tool or the AI provider rejected what the assistant sent (missing or malformed data).",
    action: "Ask the technical team to review how the assistant builds that request.",
    severity: "medium",
    matches: (s, t, http) =>
      http === 400 || http === 422 || has(`${s.exceptionType} ${t}`, /validation|invalid|bad request|malformed|schema|unexpected (?:argument|keyword)|missing .{0,20}(?:argument|parameter|field)/),
  },
  {
    id: "tool_retry",
    title: "The assistant had to retry a tool",
    explanation: "A tool asked the assistant to try again, usually with different input.",
    action: "No action needed unless it happens on most calls; then ask the technical team to review that tool.",
    severity: "low",
    matches: (s) => has(s.exceptionType.toLowerCase(), /retry/),
  },
  {
    id: "cancelled",
    title: "Execution was cancelled",
    explanation: "The execution was interrupted before finishing (for example the user left or the request was aborted).",
    action: "No action needed unless it grows suddenly.",
    severity: "low",
    matches: (s, t) => has(`${s.exceptionType} ${t}`, /cancel|abort|keyboardinterrupt/),
  },
];

const OTHER_BY_KIND: Record<string, ErrorCategoryDef> = {
  tool: {
    id: "other_tool",
    title: "A tool failed for an unrecognised reason",
    explanation: "A tool used by the assistant failed and the error does not match any known cause.",
    action: "Ask the technical team to look at the error detail.",
    severity: "medium",
  },
  llm: {
    id: "other_model",
    title: "The AI model failed for an unrecognised reason",
    explanation: "A call to the AI model failed and the error does not match any known cause.",
    action: "Ask the technical team to look at the error detail.",
    severity: "medium",
  },
};

const OTHER_DEFAULT: ErrorCategoryDef = {
  id: "other",
  title: "Unclassified error",
  explanation: "A step of the assistant failed and the error does not match any known cause.",
  action: "Ask the technical team to look at the error detail (and add a rule for it).",
  severity: "medium",
};

export function classifyError(signal: ErrorSignal): ErrorCategoryDef {
  const detail = `${signal.message} ${signal.exceptionMessage ?? ""}`;
  const text = `${detail} ${signal.exceptionType}`.toLowerCase();
  const http = extractHttpStatus(detail);
  const rule = RULES.find((r) => r.matches(signal, text, http));
  if (rule) {
    const { matches: _matches, ...def } = rule;
    return def;
  }
  return OTHER_BY_KIND[signal.kind] ?? OTHER_DEFAULT;
}

/** Quita lo que varía entre ocurrencias del mismo fallo (ids, números, rutas) para poder agruparlas. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parte del asistente afectada (herramienta o modelo) y cuántas veces falló. */
export interface AffectedPart {
  kind: string;
  name: string;
  occurrences: number;
}

export interface ErrorCategorySummary extends ErrorCategoryDef {
  occurrences: number;
  /** ocurrencias de la misma categoría en el periodo anterior de igual duración */
  previousOccurrences: number;
  traces: number;
  conversations: number;
  firstSeenMs: number;
  lastSeenMs: number;
  /** las partes más afectadas, de más a menos */
  affected: AffectedPart[];
  /** mensaje técnico más frecuente, normalizado, para quien quiera el detalle */
  sample: string;
}

export interface ErrorOverview {
  range: TimeRange;
  /** null si el periodo anterior queda fuera de la retención: no hay con qué comparar */
  previousRange: TimeRange | null;
  totals: Omit<ErrorGroupsResult, "groups"> & { occurrences: number };
  categories: ErrorCategorySummary[];
}

const MAX_AFFECTED = 5;
const SEVERITY_ORDER: Record<ErrorSeverity, number> = { high: 0, medium: 1, low: 2 };

interface Accumulator {
  def: ErrorCategoryDef;
  occurrences: number;
  traces: number;
  conversations: number;
  firstSeenMs: number;
  lastSeenMs: number;
  parts: Map<string, AffectedPart>;
  messages: Map<string, number>;
}

function accumulate(groups: ErrorGroup[]): Map<string, Accumulator> {
  const byCategory = new Map<string, Accumulator>();
  for (const g of groups) {
    const def = classifyError(g);
    const acc =
      byCategory.get(def.id) ??
      { def, occurrences: 0, traces: 0, conversations: 0, firstSeenMs: g.firstSeenMs, lastSeenMs: g.lastSeenMs, parts: new Map(), messages: new Map() };
    acc.occurrences += g.occurrences;
    // los grupos de una categoría pueden solaparse (una traza con dos mensajes distintos): sumar sobrecuenta, y el tope lo pone el total global
    acc.traces += g.traces;
    acc.conversations += g.conversations;
    acc.firstSeenMs = Math.min(acc.firstSeenMs, g.firstSeenMs);
    acc.lastSeenMs = Math.max(acc.lastSeenMs, g.lastSeenMs);
    const partKey = `${g.kind}\u0000${g.name}`;
    const part = acc.parts.get(partKey) ?? { kind: g.kind, name: g.name, occurrences: 0 };
    part.occurrences += g.occurrences;
    acc.parts.set(partKey, part);
    const normalized = normalizeMessage(g.message || g.exceptionMessage);
    acc.messages.set(normalized, (acc.messages.get(normalized) ?? 0) + g.occurrences);
    byCategory.set(def.id, acc);
  }
  return byCategory;
}

/**
 * Resume los errores del periodo por categoría de negocio y los compara con el periodo anterior.
 * Orden: severidad, luego frecuencia. Las trazas/conversaciones por categoría nunca superan el total global.
 */
export function summarizeErrors(current: ErrorGroupsResult, previous: ErrorGroupsResult | null, range: TimeRange, previousRange: TimeRange | null): ErrorOverview {
  const now = accumulate(current.groups);
  const before = accumulate(previous?.groups ?? []);
  const categories = [...now.values()]
    .map<ErrorCategorySummary>((a) => ({
      ...a.def,
      occurrences: a.occurrences,
      previousOccurrences: before.get(a.def.id)?.occurrences ?? 0,
      traces: Math.min(a.traces, current.tracesWithErrors),
      conversations: Math.min(a.conversations, current.conversationsWithErrors),
      firstSeenMs: a.firstSeenMs,
      lastSeenMs: a.lastSeenMs,
      affected: [...a.parts.values()].sort((x, y) => y.occurrences - x.occurrences).slice(0, MAX_AFFECTED),
      sample: [...a.messages.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "",
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.occurrences - a.occurrences);
  const { groups, ...totals } = current;
  return { range, previousRange, totals: { ...totals, occurrences: groups.reduce((n, g) => n + g.occurrences, 0) }, categories };
}
