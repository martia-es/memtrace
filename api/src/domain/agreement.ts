/** Acuerdo juez-humano e inter-anotador (ADR-040). Lógica pura, sin I/O: recibe etiquetas ya emparejadas por objetivo. */
import type { ScoreDataType } from "@/domain/evaluation";

/** Por debajo de este número de objetivos emparejados las métricas se devuelven, pero marcadas `lowSample`. */
export const MIN_AGREEMENT_SAMPLE = 20;
/** Tope de desacuerdos que se devuelven con cada métrica (la UI enlaza a cada uno). */
export const MAX_DISAGREEMENTS = 100;

export type AgreementStatus = "ok" | "incomparable" | "mixed_judges";

/** Un valor puesto por el juez sobre un objetivo. `target` es una clave opaca (p. ej. `run:<id>:<índice>`). */
export interface JudgeLabel {
  target: string;
  value: string;
}

/** Un valor puesto por una persona sobre un objetivo. */
export interface HumanLabel extends JudgeLabel {
  annotatorId: string;
}

export interface ConfusionMatrix {
  /** Etiquetas en el mismo orden de filas y columnas. */
  labels: string[];
  /** `matrix[h][j]`: objetivos que el humano etiquetó `labels[h]` y el juez `labels[j]`. */
  matrix: number[][];
}

export interface Disagreement {
  target: string;
  judge: string;
  human: string;
}

export interface JudgeHumanMetric {
  name: string;
  dataType: ScoreDataType;
  status: AgreementStatus;
  reason?: string;
  /** Objetivos emparejados que entran en las métricas. */
  n: number;
  excluded: { ties: number; noHuman: number; noJudge: number; invalid: number };
  percentAgreement: number | null;
  kappa: number | null;
  kappaReason?: "no_variance";
  /** Humano como referencia, positivo = `true`. Solo boolean. */
  binary?: { tp: number; fp: number; fn: number; tn: number };
  confusion?: ConfusionMatrix;
  mae?: number | null;
  pearson?: number | null;
  spearman?: number | null;
  /** Fracción de objetivos con |juez − humano| ≤ 1. Solo numeric. */
  withinOne?: number | null;
  lowSample: boolean;
  disagreements: Disagreement[];
}

export interface InterAnnotatorMetric {
  name: string;
  dataType: ScoreDataType;
  /** Anotadores distintos con al menos una etiqueta válida. */
  annotators: number;
  /** Objetivos con al menos dos anotadores. */
  n: number;
  /** Pares de anotadores con métrica definida que entran en la media. */
  pairs: number;
  meanPairwiseKappa?: number | null;
  meanPairwiseSpearman?: number | null;
  lowSample: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------------------------------------------------

/** Interpreta un valor serializado según su tipo; `null` si no es válido (nunca `NaN`). */
export function parseValue(dataType: ScoreDataType, raw: string): string | number | null {
  switch (dataType) {
    case "numeric": {
      const text = raw.trim();
      if (text === "") return null;
      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    }
    case "boolean":
      return raw === "true" || raw === "false" ? raw : null;
    case "categorical":
      return raw === "" ? null : raw;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Estadística básica
// ---------------------------------------------------------------------------------------------------------------------

/** Kappa de Cohen entre dos listas de etiquetas del mismo largo. `null` si el acuerdo esperado es 1 (sin varianza). */
export function cohenKappa(a: string[], b: string[]): number | null {
  const n = a.length;
  if (n === 0 || n !== b.length) return null;
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  let agree = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    countsA.set(x, (countsA.get(x) ?? 0) + 1);
    countsB.set(y, (countsB.get(y) ?? 0) + 1);
    if (x === y) agree++;
  }
  let expected = 0;
  for (const [label, countA] of countsA) expected += (countA / n) * ((countsB.get(label) ?? 0) / n);
  if (expected >= 1) return null;
  return (agree / n - expected) / (1 - expected);
}

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2 || n !== y.length) return null;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/** Rangos 1..n; los empates reciben el rango medio. */
export function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((p, q) => p.value - q.value);
  const result = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k]!.index] = rank;
    i = j + 1;
  }
  return result;
}

export function spearman(x: number[], y: number[]): number | null {
  if (x.length < 2 || x.length !== y.length) return null;
  return pearson(ranks(x), ranks(y));
}

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

// ---------------------------------------------------------------------------------------------------------------------
// Juez vs humano
// ---------------------------------------------------------------------------------------------------------------------

export interface JudgeHumanInput {
  name: string;
  judgeDataType: ScoreDataType;
  humanDataType: ScoreDataType;
  judge: JudgeLabel[];
  human: HumanLabel[];
  minSample?: number;
}

/** Métrica sin cálculo (tipos incomparables o jueces mezclados): solo dice por qué. */
export function emptyJudgeHumanMetric(name: string, dataType: ScoreDataType, status: Exclude<AgreementStatus, "ok">, reason: string): JudgeHumanMetric {
  return {
    name,
    dataType,
    status,
    reason,
    n: 0,
    excluded: { ties: 0, noHuman: 0, noJudge: 0, invalid: 0 },
    percentAgreement: null,
    kappa: null,
    lowSample: true,
    disagreements: [],
  };
}

export function computeJudgeHuman(input: JudgeHumanInput): JudgeHumanMetric {
  const { name, judgeDataType, humanDataType } = input;
  if (judgeDataType !== humanDataType) {
    return emptyJudgeHumanMetric(name, judgeDataType, "incomparable", `judge scores are ${judgeDataType} but human labels are ${humanDataType}`);
  }
  const dataType = judgeDataType;
  const minSample = input.minSample ?? MIN_AGREEMENT_SAMPLE;
  const excluded = { ties: 0, noHuman: 0, noJudge: 0, invalid: 0 };

  const judgeByTarget = new Map<string, string | number>();
  for (const label of input.judge) {
    const parsed = parseValue(dataType, label.value);
    if (parsed === null) excluded.invalid++;
    else judgeByTarget.set(label.target, parsed);
  }
  const humanByTarget = new Map<string, Array<string | number>>();
  for (const label of input.human) {
    const parsed = parseValue(dataType, label.value);
    if (parsed === null) {
      excluded.invalid++;
      continue;
    }
    const list = humanByTarget.get(label.target) ?? [];
    list.push(parsed);
    humanByTarget.set(label.target, list);
  }

  const pairs: Array<{ target: string; judge: string | number; human: string | number }> = [];
  for (const [target, judgeValue] of judgeByTarget) {
    const humanValues = humanByTarget.get(target);
    if (!humanValues) {
      excluded.noHuman++;
      continue;
    }
    const consensus = dataType === "numeric" ? mean(humanValues as number[]) : majority(humanValues as string[]);
    if (consensus === null) {
      excluded.ties++;
      continue;
    }
    pairs.push({ target, judge: judgeValue, human: consensus });
  }
  for (const target of humanByTarget.keys()) if (!judgeByTarget.has(target)) excluded.noJudge++;

  const n = pairs.length;
  const base: JudgeHumanMetric = {
    name,
    dataType,
    status: "ok",
    n,
    excluded,
    percentAgreement: null,
    kappa: null,
    lowSample: n < minSample,
    disagreements: [],
  };
  if (n === 0) return base;

  if (dataType === "numeric") return { ...base, ...numericStats(pairs as Array<{ target: string; judge: number; human: number }>) };
  return { ...base, ...categoricalStats(dataType, pairs as Array<{ target: string; judge: string; human: string }>) };
}

/** Etiqueta más votada; `null` si hay empate en el primer puesto. */
function majority(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  }
  return tied ? null : best;
}

function categoricalStats(
  dataType: ScoreDataType,
  pairs: Array<{ target: string; judge: string; human: string }>,
): Pick<JudgeHumanMetric, "percentAgreement" | "kappa" | "kappaReason" | "confusion" | "binary" | "disagreements"> {
  const judge = pairs.map((p) => p.judge);
  const human = pairs.map((p) => p.human);
  const labels = dataType === "boolean" ? ["true", "false"] : [...new Set([...human, ...judge])].sort();
  const index = new Map(labels.map((label, i) => [label, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const p of pairs) matrix[index.get(p.human)!]![index.get(p.judge)!]!++;

  const kappa = cohenKappa(judge, human);
  const result: ReturnType<typeof categoricalStats> = {
    percentAgreement: pairs.filter((p) => p.judge === p.human).length / pairs.length,
    kappa,
    confusion: { labels, matrix },
    disagreements: pairs.filter((p) => p.judge !== p.human).slice(0, MAX_DISAGREEMENTS).map(({ target, judge: j, human: h }) => ({ target, judge: j, human: h })),
  };
  if (kappa === null) result.kappaReason = "no_variance";
  if (dataType === "boolean") result.binary = { tp: matrix[0]![0]!, fn: matrix[0]![1]!, fp: matrix[1]![0]!, tn: matrix[1]![1]! };
  return result;
}

function numericStats(
  pairs: Array<{ target: string; judge: number; human: number }>,
): Pick<JudgeHumanMetric, "percentAgreement" | "mae" | "pearson" | "spearman" | "withinOne" | "disagreements"> {
  const judge = pairs.map((p) => p.judge);
  const human = pairs.map((p) => p.human);
  const diffs = pairs.map((p) => Math.abs(p.judge - p.human));
  return {
    percentAgreement: pairs.filter((p) => p.judge === p.human).length / pairs.length,
    mae: mean(diffs),
    pearson: pearson(judge, human),
    spearman: spearman(judge, human),
    withinOne: diffs.filter((d) => d <= 1).length / pairs.length,
    disagreements: pairs
      .filter((p) => Math.abs(p.judge - p.human) > 1)
      .sort((p, q) => Math.abs(q.judge - q.human) - Math.abs(p.judge - p.human))
      .slice(0, MAX_DISAGREEMENTS)
      .map(({ target, judge: j, human: h }) => ({ target, judge: String(j), human: String(h) })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Inter-anotador
// ---------------------------------------------------------------------------------------------------------------------

export interface InterAnnotatorInput {
  name: string;
  dataType: ScoreDataType;
  labels: HumanLabel[];
  minSample?: number;
}

/** Media de la métrica por pares de anotadores (kappa en boolean/categorical, Spearman en numeric). */
export function computeInterAnnotator(input: InterAnnotatorInput): InterAnnotatorMetric {
  const { name, dataType } = input;
  const minSample = input.minSample ?? MIN_AGREEMENT_SAMPLE;

  // anotador -> objetivo -> valor (si una persona repite objetivo, gana la última etiqueta)
  const byAnnotator = new Map<string, Map<string, string | number>>();
  for (const label of input.labels) {
    const parsed = parseValue(dataType, label.value);
    if (parsed === null) continue;
    const targets = byAnnotator.get(label.annotatorId) ?? new Map<string, string | number>();
    targets.set(label.target, parsed);
    byAnnotator.set(label.annotatorId, targets);
  }

  const annotatorsPerTarget = new Map<string, number>();
  for (const targets of byAnnotator.values()) for (const target of targets.keys()) annotatorsPerTarget.set(target, (annotatorsPerTarget.get(target) ?? 0) + 1);
  const n = [...annotatorsPerTarget.values()].filter((count) => count >= 2).length;

  const ids = [...byAnnotator.keys()].sort();
  const values: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byAnnotator.get(ids[i]!)!;
      const b = byAnnotator.get(ids[j]!)!;
      const shared = [...a.keys()].filter((target) => b.has(target));
      if (shared.length === 0) continue;
      const metric =
        dataType === "numeric"
          ? spearman(shared.map((t) => a.get(t) as number), shared.map((t) => b.get(t) as number))
          : cohenKappa(shared.map((t) => a.get(t) as string), shared.map((t) => b.get(t) as string));
      if (metric !== null) values.push(metric);
    }
  }

  const average = values.length > 0 ? mean(values) : null;
  return {
    name,
    dataType,
    annotators: ids.length,
    n,
    pairs: values.length,
    ...(dataType === "numeric" ? { meanPairwiseSpearman: average } : { meanPairwiseKappa: average }),
    lowSample: n < minSample,
  };
}
