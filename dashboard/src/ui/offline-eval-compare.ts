import type { DatasetItemChangeDto, DatasetRunItemResultDto, DatasetRunSummaryDto, ScoreAggregateDto, ScoreDto } from "@contract";
import { judgeChanged } from "@/domain/evaluation";

/** Los items de dos runs no comparten índice si las versiones del dataset difieren, así que se emparejan por contenido de `input`. */
export function inputKey(input: unknown): string {
  return JSON.stringify(input ?? null);
}

export interface PairedItem {
  key: string;
  a: DatasetRunItemResultDto;
  b: DatasetRunItemResultDto;
}

export interface ItemPairing {
  paired: PairedItem[];
  onlyA: DatasetRunItemResultDto[];
  onlyB: DatasetRunItemResultDto[];
}

export function pairItems(a: DatasetRunItemResultDto[], b: DatasetRunItemResultDto[]): ItemPairing {
  const byKeyB = new Map<string, DatasetRunItemResultDto[]>();
  for (const item of b) {
    const k = inputKey(item.input);
    byKeyB.set(k, [...(byKeyB.get(k) ?? []), item]);
  }
  const paired: PairedItem[] = [];
  const onlyA: DatasetRunItemResultDto[] = [];
  for (const item of a) {
    const k = inputKey(item.input);
    const match = byKeyB.get(k)?.shift();
    if (match) paired.push({ key: k, a: item, b: match });
    else onlyA.push(item);
  }
  const onlyB = [...byKeyB.values()].flat();
  return { paired, onlyA, onlyB };
}

export type ItemOutcome = "regressed" | "improved" | "unchanged";

/** Un booleano pasa de true→false (regresión) o false→true (mejora); un numérico por el signo de la diferencia. */
export function scoreOutcome(a: ScoreDto | undefined, b: ScoreDto | undefined): ItemOutcome | null {
  if (!a || !b || a.dataType !== b.dataType) return null;
  if (a.dataType === "boolean") {
    if (a.value === b.value) return "unchanged";
    return b.value === "true" ? "improved" : "regressed";
  }
  if (a.dataType === "numeric") {
    const x = Number(a.value);
    const y = Number(b.value);
    if (Number.isNaN(x) || Number.isNaN(y) || x === y) return "unchanged";
    return y > x ? "improved" : "regressed";
  }
  return null;
}

export interface ItemFlip {
  pair: PairedItem;
  evaluator: string;
  outcome: "regressed" | "improved";
  before: string;
  after: string;
}

/** Items emparejados cuyo resultado cambió en algún evaluador de `evaluators` (o en todos si es `null`), regresiones primero. */
export function itemFlips(pairs: PairedItem[], evaluators: string[] | null = null): ItemFlip[] {
  const flips: ItemFlip[] = [];
  for (const pair of pairs) {
    for (const sa of pair.a.scores) {
      if (evaluators && !evaluators.includes(sa.name)) continue;
      const sb = pair.b.scores.find((s) => s.name === sa.name);
      const outcome = scoreOutcome(sa, sb);
      if (outcome === "regressed" || outcome === "improved") flips.push({ pair, evaluator: sa.name, outcome, before: sa.value, after: sb!.value });
    }
  }
  return flips.sort((x, y) => (x.outcome === y.outcome ? 0 : x.outcome === "regressed" ? -1 : 1));
}

export interface EvaluatorDelta {
  name: string;
  dataType: ScoreAggregateDto["dataType"];
  a: number | null;
  b: number | null;
  /** `b - a`; en puntos porcentuales (0-1) para booleanos. */
  delta: number | null;
  isRate: boolean;
  /** El juez cambió entre A y B: la diferencia no es atribuible solo al agente (ADR-043). */
  judgeChanged: boolean;
}

export function evaluatorDeltas(a: DatasetRunSummaryDto, b: DatasetRunSummaryDto): EvaluatorDelta[] {
  const names = new Set([...a.aggregates, ...b.aggregates].filter((x) => x.passRate !== null || x.average !== null).map((x) => x.name));
  return [...names].sort().map((name) => {
    const x = a.aggregates.find((g) => g.name === name);
    const y = b.aggregates.find((g) => g.name === name);
    const isRate = (x?.passRate ?? y?.passRate ?? null) !== null;
    const av = (isRate ? x?.passRate : x?.average) ?? null;
    const bv = (isRate ? y?.passRate : y?.average) ?? null;
    return {
      name,
      dataType: (x ?? y)!.dataType,
      a: av,
      b: bv,
      delta: av !== null && bv !== null ? bv - av : null,
      isRate,
      judgeChanged: judgeChanged(x, y),
    };
  });
}

/** El item de dataset (añadido/modificado/eliminado entre versiones) que explica una diferencia, buscado por `input`. */
export function datasetChangeFor(changes: DatasetItemChangeDto[], input: unknown): DatasetItemChangeDto | null {
  const k = inputKey(input);
  return changes.find((c) => (c.after && inputKey(c.after.input) === k) || (c.before && inputKey(c.before.input) === k)) ?? null;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

export interface LatencySummary {
  count: number;
  /** Items con `traceId` sobre el total: la latencia solo se conoce para estos (ADR-042, limitación 3). */
  covered: number;
  total: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarizeLatency(durationsMs: number[], covered: number, total: number): LatencySummary {
  const sorted = [...durationsMs].sort((x, y) => x - y);
  return { count: sorted.length, covered, total, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1] ?? null };
}

export const LATENCY_ITEM_CAP = 100;
const LATENCY_CONCURRENCY = 6;

/** Duración de la traza de cada item con `traceId` (hasta `LATENCY_ITEM_CAP`), con concurrencia acotada. No hay endpoint por lotes. */
export async function loadItemLatencies(
  items: DatasetRunItemResultDto[],
  getTraceDuration: (traceId: string) => Promise<number>,
): Promise<{ byIndex: Map<number, number>; summary: LatencySummary }> {
  const traced = items.filter((i) => i.traceId);
  const queue = traced.slice(0, LATENCY_ITEM_CAP);
  const byIndex = new Map<number, number>();
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        byIndex.set(item.itemIndex, await getTraceDuration(item.traceId!));
      } catch {
        // una traza no disponible (expirada, otro servicio) no invalida el resto
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LATENCY_CONCURRENCY, queue.length) }, worker));
  return { byIndex, summary: summarizeLatency([...byIndex.values()], traced.length, items.length) };
}
