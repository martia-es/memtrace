/**
 * Calidad por modelo (ADR-025, ampliación): cruza el catálogo de precios (LiteLLM) con el leaderboard de Arena por nombre.
 *
 * Los nombres solo coinciden en parte, y un sufijo no es cosmético (`claude-opus-4-7` 1483, `claude-opus-4-7-high` 1490),
 * así que hay dos niveles y nada más: **exacto** (misma clave) se enseña sin preguntar; **candidato** (misma clave al quitar
 * esfuerzo, tamaño o fecha) espera a que una persona lo confirme. Sin coincidencia aproximada: un número equivocado en
 * silencio es peor que una celda vacía. Todo son funciones puras; lo único que se guarda son las decisiones.
 */

/** Una fila del leaderboard de Arena (`memtrace.model_quality`). */
export interface ArenaModel {
  modelName: string;
  organization: string;
  license: string;
  rating: number;
  ratingLower: number;
  ratingUpper: number;
  voteCount: number;
  rank: number;
  /** fecha del leaderboard del que salió la fila */
  publishedAtMs: number;
  /** cuándo la escribió el worker (frescura de la sincronización) */
  updatedAtMs: number;
}

export type MatchDecisionKind = "confirmed" | "rejected" | "no_equivalent";

/** Decisión de una organización sobre una clave de modelo. `no_equivalent` no apunta a ninguna entrada (`arenaModelName` = ''). */
export interface MatchDecision {
  modelKey: string;
  arenaModelName: string;
  decision: MatchDecisionKind;
}

export type QualityState = "matched" | "candidate" | "none" | "no_equivalent";

export interface QualityScore {
  arenaName: string;
  elo: number;
  /** semi-anchura del intervalo de confianza (± Elo) */
  ci: number;
  rank: number;
  votes: number;
  /** `exact`: coincidencia automática; `confirmed`: la confirmó una persona */
  origin: "exact" | "confirmed";
  /** la entrada ya no está en el último leaderboard: se enseña la última puntuación conocida */
  stale: boolean;
}

export interface QualityCandidate {
  arenaName: string;
  elo: number;
  ci: number;
  rank: number;
  votes: number;
  /** por qué se propone, en una frase para la persona */
  reason: string;
}

export interface ModelQualityRow {
  /** id tal cual está en el catálogo de precios */
  modelId: string;
  /** clave de modelo: la que comparten el id y sus copias con prefijo de proveedor */
  modelKey: string;
  state: QualityState;
  /** el modelo aparece en las trazas del experimento */
  inUse: boolean;
  quality: QualityScore | null;
  /** el candidato más cercano, si el estado es `candidate` */
  candidate: QualityCandidate | null;
  candidateCount: number;
  /** si el id lleva prefijo de proveedor, la clave de la que hereda la puntuación */
  via: string | null;
}

// ── nombres ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sufijos que cambian cómo se ejecuta el modelo, no cuál es. Alteran la puntuación, así que solo llevan a *candidato*. */
const MODE_TOKENS = new Set(["high", "medium", "low", "minimal", "max", "xhigh", "thinking", "reasoning", "preview", "latest", "extended", "beta", "exp", "experimental", "instant", "chat"]);
const NEGATION = new Set(["no", "non"]);
const SIZE_TOKEN = /^\d+k$/;
const YEAR = /^20\d\d$/;
const TWO_DIGITS = /^\d\d$/;
const COMPACT_DATE = /^20\d{6}$/;
const MMDD = /^\d{4}$/;

/**
 * Clave de un nombre: minúsculas, sin ruta ni prefijo de proveedor (`azure/gpt-5.2`, `bedrock/us.anthropic.claude-…`),
 * sin la versión de Bedrock (`-v1:0`) y con todo lo que no es letra, cifra o punto convertido en guion.
 */
export function modelKey(name: string): string {
  let s = name.trim().toLowerCase();
  s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(/-v\d+:\d+$/, "").replace(/:\d+$/, "").replace(/@/g, "-");
  while (/^[a-z]+\.(?=[a-z])/.test(s)) s = s.replace(/^[a-z]+\./, ""); // `anthropic.`, `us.anthropic.`
  return s.replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Dos claves son «iguales» aunque cambie la puntuación: `claude-3-5-sonnet` y `claude-3.5-sonnet`. */
export const squash = (key: string): string => key.replace(/[^a-z0-9]/g, "");

/** La clave sin esfuerzo, tamaño ni fecha. Número de fichas quitadas incluido, para ordenar candidatos por cercanía. */
export function candidateBase(key: string): { base: string; removed: number } {
  const tokens = key.split("-").filter(Boolean);
  const start = tokens.length;
  for (;;) {
    const n = tokens.length;
    if (n <= 1) break;
    const last = tokens[n - 1]!;
    const prev = tokens[n - 2];
    const prev2 = tokens[n - 3];
    const isDate3 = n > 3 && TWO_DIGITS.test(prev ?? "") && TWO_DIGITS.test(last) && (YEAR.test(prev2 ?? "") || TWO_DIGITS.test(prev2 ?? "")); // 2024-12-17, 26-02-10
    const isDate2 = n > 2 && TWO_DIGITS.test(prev ?? "") && TWO_DIGITS.test(last) && !/^\d/.test(prev2 ?? ""); // -02-24
    if (isDate3) tokens.splice(n - 3, 3);
    else if (isDate2) tokens.splice(n - 2, 2);
    else if (COMPACT_DATE.test(last) || (MMDD.test(last) && n > 2)) tokens.pop();
    else if (SIZE_TOKEN.test(last)) tokens.pop();
    else if (MODE_TOKENS.has(last)) {
      tokens.pop();
      if (last === "thinking" && NEGATION.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
    } else break;
  }
  const base = tokens.join("-");
  // no se vacía un nombre: sin letras o con un solo carácter no hay base fiable
  if (base.length < 2 || !/[a-z]/.test(base)) return { base: key, removed: 0 };
  return { base, removed: start - tokens.length };
}

const eloCi = (m: ArenaModel): number => Math.max(0, Math.round((m.ratingUpper - m.ratingLower) / 2));

function toScore(m: ArenaModel, origin: QualityScore["origin"], latestPublishedAtMs: number): QualityScore {
  return { arenaName: m.modelName, elo: Math.round(m.rating), ci: eloCi(m), rank: m.rank, votes: m.voteCount, origin, stale: m.publishedAtMs < latestPublishedAtMs };
}

function toCandidate(m: ArenaModel, reason: string): QualityCandidate {
  return { arenaName: m.modelName, elo: Math.round(m.rating), ci: eloCi(m), rank: m.rank, votes: m.voteCount, reason };
}

function reasonFor(pricingKey: string, arenaKey: string): string {
  const a = candidateBase(arenaKey);
  const p = candidateBase(pricingKey);
  if (a.removed > 0 && p.removed === 0) {
    const extra = arenaKey.startsWith(a.base) ? arenaKey.slice(a.base.length).replace(/^-/, "") : "";
    return extra ? `Same name plus “${extra}”` : "Same name plus a suffix";
  }
  if (p.removed > 0 && a.removed === 0) {
    const extra = pricingKey.startsWith(p.base) ? pricingKey.slice(p.base.length).replace(/^-/, "") : "";
    return extra ? `Same name without “${extra}”` : "Same name without a suffix";
  }
  return "Same name once suffixes and dates are ignored";
}

// ── resolución ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ResolveInput {
  /** ids del catálogo de precios */
  pricingIds: readonly string[];
  arena: readonly ArenaModel[];
  decisions: readonly MatchDecision[];
  /** valores de `gen_ai.request.model` vistos en las trazas */
  usedModels: readonly string[];
}

/** Fichas que no comparten dos claves: cuanto menos, más cerca está el candidato (`…-chat-latest-20260210` gana a `…`). */
function tokenDistance(a: string, b: string): number {
  const ta = a.split("-");
  const tb = b.split("-");
  const rest = [...tb];
  let shared = 0;
  for (const t of ta) {
    const i = rest.indexOf(t);
    if (i >= 0) {
      rest.splice(i, 1);
      shared++;
    }
  }
  return ta.length - shared + rest.length;
}

/** Candidatos de una clave, del más cercano al más lejano; sin los que la organización ya descartó. */
export function candidatesFor(key: string, arena: readonly ArenaModel[], rejected: ReadonlySet<string> = new Set()): QualityCandidate[] {
  const target = squash(candidateBase(key).base);
  const own = squash(key);
  return arena
    .map((m) => ({ m, k: modelKey(m.modelName) }))
    .filter(({ m, k }) => !rejected.has(m.modelName) && squash(k) !== own && squash(candidateBase(k).base) === target)
    .map(({ m, k }) => ({ m, k, distance: tokenDistance(key, k) }))
    .sort((a, b) => a.distance - b.distance || b.m.voteCount - a.m.voteCount)
    .map(({ m, k }) => toCandidate(m, reasonFor(key, k)));
}

/**
 * Estado de calidad de cada modelo del catálogo para una organización. Precedencia: confirmado > sin equivalente > exacto >
 * candidato > nada. Los ids que comparten clave comparten decisión y puntuación.
 */
export function resolveModelQuality(input: ResolveInput): { rows: ModelQualityRow[]; latestPublishedAtMs: number } {
  const latest = input.arena.reduce((max, m) => Math.max(max, m.publishedAtMs), 0);
  const byName = new Map(input.arena.map((m) => [m.modelName, m]));
  const bySquash = new Map<string, ArenaModel>();
  for (const m of input.arena) {
    const k = squash(modelKey(m.modelName));
    const current = bySquash.get(k);
    if (!current || m.voteCount > current.voteCount) bySquash.set(k, m);
  }
  const decisionsByKey = new Map<string, MatchDecision[]>();
  for (const d of input.decisions) decisionsByKey.set(d.modelKey, [...(decisionsByKey.get(d.modelKey) ?? []), d]);
  const used = new Set(input.usedModels.map((m) => squash(candidateBase(modelKey(m)).base)));

  const perKey = new Map<string, Pick<ModelQualityRow, "state" | "quality" | "candidate" | "candidateCount">>();
  const resolveKey = (key: string): Pick<ModelQualityRow, "state" | "quality" | "candidate" | "candidateCount"> => {
    const cached = perKey.get(key);
    if (cached) return cached;
    const own = decisionsByKey.get(key) ?? [];
    const confirmed = own.find((d) => d.decision === "confirmed");
    const rejected = new Set(own.filter((d) => d.decision === "rejected").map((d) => d.arenaModelName));
    let result: Pick<ModelQualityRow, "state" | "quality" | "candidate" | "candidateCount">;
    const confirmedModel = confirmed ? byName.get(confirmed.arenaModelName) : undefined;
    const exact = bySquash.get(squash(key));
    if (confirmedModel) result = { state: "matched", quality: toScore(confirmedModel, "confirmed", latest), candidate: null, candidateCount: 0 };
    else if (own.some((d) => d.decision === "no_equivalent")) result = { state: "no_equivalent", quality: null, candidate: null, candidateCount: 0 };
    else if (exact) result = { state: "matched", quality: toScore(exact, "exact", latest), candidate: null, candidateCount: 0 };
    else {
      const candidates = candidatesFor(key, input.arena, rejected);
      result = candidates.length > 0 ? { state: "candidate", quality: null, candidate: candidates[0]!, candidateCount: candidates.length } : { state: "none", quality: null, candidate: null, candidateCount: 0 };
    }
    perKey.set(key, result);
    return result;
  };

  const rows = input.pricingIds.map((modelId): ModelQualityRow => {
    const key = modelKey(modelId);
    return {
      modelId,
      modelKey: key,
      ...resolveKey(key),
      inUse: used.has(squash(candidateBase(key).base)),
      via: modelId.toLowerCase() !== key ? key : null,
    };
  });
  return { rows, latestPublishedAtMs: latest };
}

/** Un modelo pendiente de decisión: tiene candidatos, nadie ha decidido y se usa. */
export const isPending = (row: Pick<ModelQualityRow, "state" | "inUse">): boolean => row.state === "candidate" && row.inUse;
