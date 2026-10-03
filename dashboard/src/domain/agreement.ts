/** Presentación del acuerdo juez-humano / inter-anotador (ADR-040). Solo formato: el cálculo vive en la API. */
import type { JudgeHumanMetricDto } from "@contract";

/** Mismo mínimo que `MIN_AGREEMENT_SAMPLE` de la API; solo se usa para el texto "needs N more". */
export const MIN_SAMPLE = 20;

/** Escala de Landis y Koch, la lectura habitual de un kappa. */
export function kappaLabel(kappa: number | null): string {
  if (kappa === null) return "n/a";
  if (kappa < 0) return "worse than chance";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
}

export function kappaTone(kappa: number | null): "positive" | "warning" | "negative" | "default" {
  if (kappa === null) return "default";
  if (kappa >= 0.6) return "positive";
  if (kappa >= 0.4) return "warning";
  return "negative";
}

export function formatKappa(kappa: number | null | undefined): string {
  return kappa === null || kappa === undefined ? "–" : kappa.toFixed(2);
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : `${Math.round(value * 100)} %`;
}

/** Por qué no hay kappa en una métrica que sí se calculó. */
export function kappaNote(metric: Pick<JudgeHumanMetricDto, "kappa" | "kappaReason">): string | null {
  if (metric.kappa !== null) return null;
  return metric.kappaReason === "no_variance" ? "Kappa is undefined: both judge and humans gave a single label to every item." : null;
}

/** Texto de una muestra pequeña, o `null` si ya es suficiente. */
export function lowSampleNote(n: number): string {
  return `Only ${n} item${n === 1 ? "" : "s"} with both a judge score and a human label — these numbers are noise until there are at least ${MIN_SAMPLE}.`;
}

export interface QueuePopulationCounts {
  manual: number;
  filter: number;
  randomSample: number;
}

/**
 * Cómo se construyó la muestra de una cola, con el aviso que corresponda: solo una muestra aleatoria permite
 * generalizar el acuerdo al resto de items (ADR-040). `tone: "warn"` = no generalizable.
 */
export function describePopulation(p: QueuePopulationCounts): { text: string; tone: "ok" | "warn" } | null {
  const total = p.manual + p.filter + p.randomSample;
  if (total === 0) return null;
  const parts = [p.randomSample ? `${p.randomSample} randomly sampled` : null, p.filter ? `${p.filter} chosen by a filter or whole run` : null, p.manual ? `${p.manual} picked by hand` : null].filter(Boolean);
  const how = `Sample: ${parts.join(", ")}.`;
  if (p.randomSample === total) return { text: `${how} Agreement can be read as representative of the items it was sampled from.`, tone: "ok" };
  return { text: `${how} Not a purely random sample, so agreement may not generalize to the other items.`, tone: "warn" };
}

/** `run:<datasetRunId>:<itemIndex>` → índice del item, o `null` si no es de este run. */
export function itemIndexOfTarget(target: string, datasetRunId: string): number | null {
  const prefix = `run:${datasetRunId}:`;
  if (!target.startsWith(prefix)) return null;
  const index = Number(target.slice(prefix.length));
  return Number.isInteger(index) ? index : null;
}
