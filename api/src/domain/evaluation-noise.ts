import type { DatasetRunItemResult, ScoreAggregate } from "./evaluation";

/**
 * Ruido de una evaluación (ADR-097). Un run lanzado con `repeats=N` son N ejecuciones del mismo código sobre los mismos datos
 * y el mismo juez: lo que varía entre ellas es azar. Aquí se calcula cuánto, y si la diferencia entre dos runs lo supera.
 * Funciones puras: sin acceso a datos.
 */

/** Veces el error estándar que debe superar una diferencia para llamarla «por encima del ruido» (~95 %). */
export const NOISE_Z = 2;
/** Una puntuación numérica es inestable si sus ejecuciones se separan más de esta fracción de su valor absoluto máximo. */
export const NUMERIC_INSTABILITY = 0.1;

export type NoiseDataType = "boolean" | "numeric";

export interface EvaluatorNoise {
  name: string;
  dataType: NoiseDataType;
  /** Resultado de cada ejecución (tasa de acierto o media); null si ese evaluador no produjo nada en ella. */
  values: Array<number | null>;
  mean: number | null;
  /** Desviación típica muestral de `values`; null con menos de dos valores. Aproximada con 2 o 3. */
  noise: number | null;
  /** Identidad de los jueces que produjeron este evaluador en todas las ejecuciones (ADR-043): dos lados solo son comparables si coincide. */
  judgeKey: string;
}

const isNoiseType = (t: string): t is NoiseDataType => t === "boolean" || t === "numeric";
const valueOf = (a: ScoreAggregate): number | null => (a.dataType === "boolean" ? a.passRate : a.dataType === "numeric" ? a.average : null);

export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
}

/** Por evaluador, lo que valió en cada ejecución (`executions[i]` = agregados de la ejecución i). Categóricos fuera: no tienen agregado. */
export function evaluatorNoise(executions: ScoreAggregate[][]): EvaluatorNoise[] {
  const keys = new Map<string, { name: string; dataType: NoiseDataType }>();
  for (const aggregates of executions) {
    for (const a of aggregates) if (isNoiseType(a.dataType)) keys.set(`${a.name}\u0000${a.dataType}`, { name: a.name, dataType: a.dataType });
  }
  return [...keys.entries()]
    .sort(([, x], [, y]) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .map(([key, { name, dataType }]) => {
      const found = executions.map((aggregates) => aggregates.find((a) => `${a.name}\u0000${a.dataType}` === key) ?? null);
      const values = found.map((a) => (a ? valueOf(a) : null));
      const present = values.filter((v): v is number => v !== null);
      const judges = found.flatMap((a) => a?.judges ?? []).map((j) => `${j.model ?? ""}|${j.promptHash ?? ""}`);
      return {
        name, dataType, values,
        mean: present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null,
        noise: sampleStdDev(present),
        judgeKey: [...new Set(judges)].sort().join(","),
      };
    });
}

export type NoiseVerdict = "above" | "within" | "not_measured";
/** Por qué no hay veredicto: sin repeticiones en ningún lado, otro dataset o versión, otro juez, o falta el valor de un lado. */
export type NotMeasuredReason = "no_repetitions" | "dataset_changed" | "judge_changed" | "no_values";

export interface NoiseSide {
  datasetId: string;
  versionMajor: number;
  versionMinor: number;
  /** Agregados de cada ejecución del run; una sola entrada si el run no tiene repeticiones. */
  executions: ScoreAggregate[][];
}

export interface EvaluatorComparison {
  name: string;
  dataType: NoiseDataType;
  baseline: number | null;
  candidate: number | null;
  /** `candidate - baseline`, en la unidad del evaluador (0-1 para booleanos). */
  delta: number | null;
  /** Lo que la diferencia debe superar para no ser ruido (`NOISE_Z` × error estándar); null si no se pudo medir. */
  margin: number | null;
  /** σ de una ejecución, combinada entre los lados que tienen repeticiones. */
  noise: number | null;
  verdict: NoiseVerdict;
  reason: NotMeasuredReason | null;
}

/**
 * Compara dos runs evaluador a evaluador y dice si la diferencia supera el ruido medido (ADR-097, sección 3).
 * El ruido se toma del lado (o los lados) con repeticiones, combinado si hay en ambos, y solo si dataset, versión y juez coinciden.
 * El error estándar de una diferencia entre medias de `nA` y `nB` ejecuciones es σ·√(1/nA + 1/nB).
 */
export function compareWithNoise(a: NoiseSide, b: NoiseSide): EvaluatorComparison[] {
  const sameData = a.datasetId === b.datasetId && a.versionMajor === b.versionMajor && a.versionMinor === b.versionMinor;
  const sideA = new Map(evaluatorNoise(a.executions).map((e) => [`${e.name}\u0000${e.dataType}`, e]));
  const sideB = new Map(evaluatorNoise(b.executions).map((e) => [`${e.name}\u0000${e.dataType}`, e]));
  const names = [...new Set([...sideA.keys(), ...sideB.keys()])].sort();
  return names.map((key) => {
    const x = sideA.get(key);
    const y = sideB.get(key);
    const { name, dataType } = (x ?? y)!;
    const baseline = x?.mean ?? null;
    const candidate = y?.mean ?? null;
    const delta = baseline !== null && candidate !== null ? candidate - baseline : null;
    const none = (reason: NotMeasuredReason): EvaluatorComparison => ({ name, dataType, baseline, candidate, delta, margin: null, noise: null, verdict: "not_measured", reason });

    if (delta === null) return none("no_values");
    const nA = x!.values.filter((v) => v !== null).length;
    const nB = y!.values.filter((v) => v !== null).length;
    const measured = [x!.noise !== null ? { sigma: x!.noise, df: nA - 1 } : null, y!.noise !== null ? { sigma: y!.noise, df: nB - 1 } : null].filter((m): m is { sigma: number; df: number } => m !== null);
    if (measured.length === 0) return none("no_repetitions");
    if (!sameData) return none("dataset_changed");
    if (x!.judgeKey !== y!.judgeKey) return none("judge_changed");

    const df = measured.reduce((s, m) => s + m.df, 0);
    const sigma = Math.sqrt(measured.reduce((s, m) => s + m.df * m.sigma ** 2, 0) / df);
    const margin = NOISE_Z * sigma * Math.sqrt(1 / nA + 1 / nB);
    return { name, dataType, baseline, candidate, delta, margin, noise: sigma, verdict: Math.abs(delta) > margin ? "above" : "within", reason: null };
  });
}

export interface UnstableItem {
  itemIndex: number;
  input: unknown;
  evaluator: string;
  /** Resultado de cada ejecución, tal como se guardó ("true", "0.8"...); null si esa ejecución no tiene score. */
  outcomes: Array<string | null>;
}

export interface Instability {
  evaluator: string;
  /** Items cuyo resultado no es el mismo en todas las ejecuciones. */
  unstable: number;
  /** Items puntuados en todas las ejecuciones. */
  total: number;
}

/** Items de un run con repeticiones cuyo resultado cambia entre ejecuciones (`executions[i]` = items de la ejecución i). */
export function unstableItems(executions: DatasetRunItemResult[][], limit = 50): { counts: Instability[]; items: UnstableItem[] } {
  const byEvaluator = new Map<string, { type: NoiseDataType; perItem: Map<number, { input: unknown; outcomes: Array<string | null> }> }>();
  executions.forEach((items, exec) => {
    for (const item of items) {
      for (const score of item.scores) {
        if (!isNoiseType(score.dataType)) continue;
        const entry = byEvaluator.get(score.name) ?? { type: score.dataType, perItem: new Map() };
        byEvaluator.set(score.name, entry);
        const slot = entry.perItem.get(item.itemIndex) ?? { input: item.input, outcomes: executions.map(() => null as string | null) };
        slot.outcomes[exec] = score.value;
        entry.perItem.set(item.itemIndex, slot);
      }
    }
  });

  const counts: Instability[] = [];
  const found: UnstableItem[] = [];
  for (const [evaluator, { type, perItem }] of [...byEvaluator.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const complete = [...perItem.entries()].filter(([, s]) => s.outcomes.every((o) => o !== null));
    const numbers = type === "numeric" ? complete.flatMap(([, s]) => s.outcomes.map((o) => Math.abs(Number(o)))).filter(Number.isFinite) : [];
    const scale = Math.max(...numbers, 1e-9);
    const unstable = complete.filter(([, s]) => {
      if (type === "boolean") return new Set(s.outcomes).size > 1;
      const nums = s.outcomes.map(Number);
      return Math.max(...nums) - Math.min(...nums) > NUMERIC_INSTABILITY * scale;
    });
    counts.push({ evaluator, unstable: unstable.length, total: complete.length });
    for (const [itemIndex, s] of unstable) found.push({ itemIndex, input: s.input, evaluator, outcomes: s.outcomes });
  }
  return { counts, items: found.slice(0, limit) };
}
