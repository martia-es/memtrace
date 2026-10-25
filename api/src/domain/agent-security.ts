import type { DatasetRunItemResult } from "./evaluation";

/** Postura de seguridad de un agente (ADR-103): eventos de los detectores en producción y runs de red team. Solo lectura. */

/** Los runs de red team son runs de evaluación normales cuyo nombre empieza así (ADR-103 §1). */
export const REDTEAM_RUN_PREFIX = "redteam/";
/** Score categórico que el SDK añade a cada item de un run de red team: los items no guardan metadatos. */
export const ATTACK_CATEGORY_SCORE = "attack_category";
export const UNCATEGORIZED = "uncategorized";
export const MAX_REDTEAM_RUNS = 10;
export const DEFAULT_SECURITY_DAYS = 30;
export const MAX_SECURITY_DAYS = 365;
const DAY_MS = 86_400_000;

/** Eventos agrupados tal como salen del almacén: una fila por (detector, categoría, severidad, acción, día UTC). */
export interface SecurityEventRow {
  detector: string;
  category: string;
  severity: string;
  action: string;
  /** `YYYY-MM-DD` en UTC */
  day: string;
  count: number;
}

export interface SecurityEvents {
  total: number;
  /** eventos con `security.action = blocked`: el agente cortó la ejecución */
  blocked: number;
  byDetector: Array<{ detector: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  /** un punto por día del periodo, con ceros, el más antiguo primero */
  daily: Array<{ date: string; count: number }>;
}

export interface RedTeamCategory {
  category: string;
  items: number;
  attacksSucceeded: number;
  /** tasa de éxito del ataque: attacksSucceeded / items */
  asr: number | null;
}

export interface RedTeamRun {
  runId: string;
  /** el dataset del run, para enlazar a su página */
  datasetId: string;
  name: string;
  createdAt: string;
  revision: string | null;
  /** items evaluados (sin error y con algún score booleano) */
  items: number;
  /** items sin resultado porque la tarea falló; no cuentan en `items` ni en el ASR */
  errored: number;
  attacksSucceeded: number;
  asr: number | null;
  byCategory: RedTeamCategory[];
}

export interface SecurityPosture {
  days: number;
  events: SecurityEvents;
  redteam: { runs: RedTeamRun[] };
}

export function isRedTeamRun(name: string): boolean {
  return name.startsWith(REDTEAM_RUN_PREFIX);
}

const countBy = <K extends string>(rows: SecurityEventRow[], key: (r: SecurityEventRow) => string, label: K) => {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.count);
  return [...totals].map(([name, count]) => ({ [label]: name, count }) as Record<K, string> & { count: number }).sort((a, b) => b.count - a.count || String(a[label]).localeCompare(String(b[label])));
};

/** Pliega las filas del almacén en los totales de la pantalla. `daily` cubre los `days` días que terminan en `nowMs`. */
export function buildSecurityEvents(rows: SecurityEventRow[], days: number, nowMs: number): SecurityEvents {
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.count);
  const daily: SecurityEvents["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10);
    daily.push({ date, count: perDay.get(date) ?? 0 });
  }
  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    blocked: rows.filter((r) => r.action === "blocked").reduce((sum, r) => sum + r.count, 0),
    byDetector: countBy(rows, (r) => r.detector, "detector"),
    byCategory: countBy(rows, (r) => r.category, "category"),
    bySeverity: countBy(rows, (r) => r.severity, "severity"),
    byAction: countBy(rows, (r) => r.action, "action"),
    daily,
  };
}

const rate = (succeeded: number, items: number): number | null => (items === 0 ? null : succeeded / items);

/**
 * ASR de un run de red team. Un score booleano `true` = el agente resistió; el ataque tuvo éxito si CUALQUIER score
 * booleano del item es `false`. Un item con error de la tarea no se evalúa (se cuenta aparte); uno sin scores booleanos tampoco.
 */
export function summarizeRedTeamRun(
  run: { id: string; datasetId: string; name: string; createdAt: string; revision: string | null },
  results: DatasetRunItemResult[],
): RedTeamRun {
  const byCategory = new Map<string, { items: number; succeeded: number }>();
  let errored = 0;
  let items = 0;
  let succeeded = 0;
  for (const result of results) {
    if (result.error !== null) {
      errored++;
      continue;
    }
    const booleans = result.scores.filter((s) => s.dataType === "boolean");
    if (booleans.length === 0) continue;
    const category = result.scores.find((s) => s.name === ATTACK_CATEGORY_SCORE && s.dataType === "categorical")?.value || UNCATEGORIZED;
    const attackWon = booleans.some((s) => s.value === "false");
    items++;
    if (attackWon) succeeded++;
    const bucket = byCategory.get(category) ?? { items: 0, succeeded: 0 };
    bucket.items++;
    if (attackWon) bucket.succeeded++;
    byCategory.set(category, bucket);
  }
  return {
    runId: run.id,
    datasetId: run.datasetId,
    name: run.name,
    createdAt: run.createdAt,
    revision: run.revision,
    items,
    errored,
    attacksSucceeded: succeeded,
    asr: rate(succeeded, items),
    byCategory: [...byCategory]
      .map(([category, b]) => ({ category, items: b.items, attacksSucceeded: b.succeeded, asr: rate(b.succeeded, b.items) }))
      .sort((a, b) => (b.asr ?? 0) - (a.asr ?? 0) || a.category.localeCompare(b.category)),
  };
}
