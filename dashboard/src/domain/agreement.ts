/** Presentación del acuerdo juez-humano / inter-anotador (ADR-040). Solo formato: el cálculo vive en la API. */
import type { JudgeHumanMetricDto } from "@contract";
import { tr } from "./translate";

/** Mismo mínimo que `MIN_AGREEMENT_SAMPLE` de la API; solo se usa para el texto "needs N more". */
export const MIN_SAMPLE = 20;

/** Escala de Landis y Koch, la lectura habitual de un kappa. */
export function kappaLabel(kappa: number | null): string {
  if (kappa === null) return tr("agreement.n_a");
  if (kappa < 0) return tr("agreement.worse_than_chance");
  if (kappa <= 0.2) return tr("agreement.slight");
  if (kappa <= 0.4) return tr("agreement.fair");
  if (kappa <= 0.6) return tr("agreement.moderate");
  if (kappa <= 0.8) return tr("agreement.substantial");
  return tr("agreement.almost_perfect");
}

export function kappaTone(kappa: number | null): "positive" | "warning" | "negative" | "default" {
  if (kappa === null) return "default";
  if (kappa >= 0.6) return "positive";
  if (kappa >= 0.4) return "warning";
  return "negative";
}

/**
 * Lectura para quien valora respuestas (ADR-046 de colas): mismos umbrales que `kappaTone`, en lenguaje llano.
 * Solo texto; no decide nada por sí solo.
 */
export function judgeVerdict(kappa: number | null): { tone: ReturnType<typeof kappaTone>; text: string } {
  if (kappa === null) return { tone: "default", text: tr("agreement.not_enough_labels_yet_to_compare") };
  if (kappa >= 0.6) return { tone: "positive", text: tr("agreement.matches_your_reviewers_the_judge_can") };
  if (kappa >= 0.4) return { tone: "warning", text: tr("agreement.partly_matches_check_the_judge_s") };
  return { tone: "negative", text: tr("agreement.does_not_match_your_reviewers_do") };
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
  return metric.kappaReason === "no_variance" ? tr("agreement.kappa_is_undefined_both_judge_and") : null;
}

/** Texto de una muestra pequeña, o `null` si ya es suficiente. */
export function lowSampleNote(n: number): string {
  return tr(n === 1 ? "agreement.sample.one" : "agreement.sample.other", { count: n, min: MIN_SAMPLE });
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
  const parts = [p.randomSample ? tr("agreement.count_randomly_sampled", { count: p.randomSample }) : null, p.filter ? tr("agreement.count_chosen_by_a_filter_or", { count: p.filter }) : null, p.manual ? tr("agreement.count_picked_by_hand", { count: p.manual }) : null].filter(Boolean);
  const how = tr("agreement.sample_parts", { parts: parts.join(", ") });
  if (p.randomSample === total) return { text: tr("agreement.how_agreement_can_be_read_as", { how }), tone: "ok" };
  return { text: tr("agreement.how_not_a_purely_random_sample", { how }), tone: "warn" };
}

/** `run:<datasetRunId>:<itemIndex>` → índice del item, o `null` si no es de este run. */
export function itemIndexOfTarget(target: string, datasetRunId: string): number | null {
  const prefix = `run:${datasetRunId}:`;
  if (!target.startsWith(prefix)) return null;
  const index = Number(target.slice(prefix.length));
  return Number.isInteger(index) ? index : null;
}
