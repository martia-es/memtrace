import type { DatasetRunItemResult } from "./evaluation";

/** Medidas de las alertas sobre runs de evaluación offline (ADR-086, actualización 2026-10-25). Lógica pura. */

export interface RunScore {
  /** porcentaje 0-100; null si no hay nada evaluado */
  value: number | null;
  /** items evaluados (sin error de la tarea y con el score pedido) */
  evaluated: number;
}

/** Un `target` que termina en `/` es un prefijo del nombre del run (`redteam/`); si no, el nombre exacto del dataset. */
export function matchesTarget(run: { name: string; datasetName: string }, target: string): boolean {
  return target.endsWith("/") ? run.name.startsWith(target) : run.datasetName === target;
}

/**
 * Tasa de acierto de un run en un score. Boolean `true` = acierto; numérico = media (0-1) en %. Con `score` vacío mide «cualquier
 * check»: un item acierta si ninguno de sus scores booleanos es `false`, que es 100 - ASR de un run de red team (ADR-103).
 */
export function runScore(results: DatasetRunItemResult[], score: string): RunScore {
  let evaluated = 0;
  let sum = 0;
  for (const result of results) {
    if (result.error !== null) continue;
    if (score === "") {
      const booleans = result.scores.filter((s) => s.dataType === "boolean");
      if (booleans.length === 0) continue;
      evaluated++;
      if (booleans.every((s) => s.value === "true")) sum += 1;
      continue;
    }
    const found = result.scores.find((s) => s.name === score);
    if (!found) continue;
    if (found.dataType === "boolean") {
      evaluated++;
      if (found.value === "true") sum += 1;
    } else if (found.dataType === "numeric") {
      const n = Number(found.value);
      if (!Number.isFinite(n)) continue;
      evaluated++;
      sum += n;
    }
  }
  return { value: evaluated === 0 ? null : (sum / evaluated) * 100, evaluated };
}
