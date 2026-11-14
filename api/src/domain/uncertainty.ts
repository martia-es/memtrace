/**
 * Incertidumbre de un episodio de Mem (0 = el resultado está claro, 1 = nadie sabe si salió bien). Lógica pura.
 *
 * Es lo que más conviene que mire una persona: un fallo evidente o un éxito evidente enseñan poco; lo ambiguo, mucho.
 * Dos fuentes, sin LLM y reproducibles:
 *  1. Cercanía del `value` a la zona «suspect» del worker (`analytics/mem/mem/episode.py`: SUSPECT 0.3 ≤ value < FAILED 0.6).
 *     El máximo está en el centro de la zona; en `ok` (< 0.3) y `failed` (≥ 0.6) baja linealmente hasta 0.
 *  2. Desacuerdo entre señales: un evaluador que pasa con un 👎 o un error, o uno que falla con un 👍.
 * Si cambian los umbrales del worker (sube `EPISODE_VERSION`), hay que cambiarlos aquí.
 */
export const SUSPECT_FROM = 0.3;
export const FAILED_FROM = 0.6;
const CENTER = (SUSPECT_FROM + FAILED_FROM) / 2;
const HALF_WIDTH = CENTER; // a esta distancia del centro la incertidumbre es 0 (value = 0 o value = 0.9)
const DISAGREEMENT_BONUS = 0.5;

export interface EpisodeSignals {
  value: number;
  /** -1 👎, 0 sin feedback, 1 👍 */
  thumbs: number;
  /** puntuación mínima del evaluador; null si no hay */
  evalScore: number | null;
  hasError: boolean;
  reasons: string[];
}

export function signalsDisagree(s: EpisodeSignals): boolean {
  const evalPassed = s.evalScore === 1;
  const evalFailed = s.evalScore === 0;
  return (evalPassed && (s.thumbs < 0 || s.hasError)) || (evalFailed && s.thumbs > 0) || s.reasons.includes("thumbs_mixed");
}

export function uncertainty(s: EpisodeSignals): number {
  const base = Math.max(0, 1 - Math.abs(s.value - CENTER) / HALF_WIDTH);
  const score = Math.min(1, base + (signalsDisagree(s) ? DISAGREEMENT_BONUS : 0));
  return Math.round(score * 1000) / 1000;
}
