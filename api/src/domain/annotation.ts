/** Anotaciones humanas (ADR-037): etiquetas de personas sobre una traza, validadas contra una score config (ADR-036). */
import { AnnotationValueError } from "@/domain/errors";
import type { ScoreDataType } from "@/domain/evaluation";
import type { ScoreConfig } from "@/domain/score-config";

/** Una anotación vigente. `spanId = null` etiqueta la traza entera. */
export interface Annotation {
  traceId: string;
  spanId: string | null;
  configId: string;
  /** Desnormalizados al escribir: la etiqueta se autodescribe aunque la config se archive. */
  configName: string;
  dataType: ScoreDataType;
  annotatorId: string;
  /** Serializado igual que `Score.value`. */
  value: string;
  comment: string | null;
  createdAt: string;
  /** Solo en anotaciones de un item de run (ADR-039): `traceId` es '' si el item no tiene traza. Ausentes = anotación de traza. */
  datasetRunId?: string | null;
  itemIndex?: number | null;
}

/** Score automático (`code`/`llm_judge`) de la misma traza, para la lectura unificada. */
export interface TraceScore {
  datasetRunId: string;
  itemIndex: number;
  name: string;
  value: string;
  dataType: ScoreDataType;
  source: string;
  comment: string | null;
}

export type AnnotationValue = string | number | boolean;

/**
 * Una etiqueta humana cuenta como valoración baja si es un "No" (`boolean`) o queda en la mitad inferior del rango
 * de la rúbrica (`numeric`, estrictamente por debajo del punto medio). Las categóricas no tienen orden, así que
 * nunca cuentan (ADR-049).
 */
export function isLowRating(annotation: Pick<Annotation, "dataType" | "value">, config: Pick<ScoreConfig, "minValue" | "maxValue"> | undefined): boolean {
  if (annotation.dataType === "boolean") return annotation.value === "false";
  if (annotation.dataType !== "numeric" || !config || config.minValue === null || config.maxValue === null) return false;
  const value = Number(annotation.value);
  return Number.isFinite(value) && value < (config.minValue + config.maxValue) / 2;
}

/** Las trazas con alguna valoración baja en un rango, para el aviso "Needs attention". */
export interface LowRatedSummary {
  /** trazas distintas con al menos una valoración baja */
  count: number;
  /** las más recientes primero */
  items: Array<{ traceId: string; configName: string; value: string; createdAt: string }>;
}

/** Estado de anotación de una traza o conversación: cuántas etiquetas humanas tiene y si alguna es una valoración baja. */
export interface AnnotationRating {
  id: string;
  labels: number;
  low: boolean;
}

/**
 * Comprueba que `raw` es un valor válido para la config y lo devuelve normalizado (el mismo formato
 * en que se guardan los `Score.value`). Lanza `AnnotationValueError`.
 */
export function validateAnnotationValue(config: Pick<ScoreConfig, "dataType" | "minValue" | "maxValue" | "categories">, raw: AnnotationValue): string {
  const text = String(raw).trim();
  switch (config.dataType) {
    case "numeric": {
      const value = text === "" ? NaN : Number(text);
      if (!Number.isFinite(value)) throw new AnnotationValueError(`"${text}" is not a number`);
      if (value < config.minValue! || value > config.maxValue!) {
        throw new AnnotationValueError(`${value} is outside the allowed range ${config.minValue}–${config.maxValue}`);
      }
      return String(value);
    }
    case "boolean": {
      const lower = text.toLowerCase();
      if (lower !== "true" && lower !== "false") throw new AnnotationValueError(`"${text}" is not a boolean (expected true or false)`);
      return lower;
    }
    case "categorical": {
      if (!(config.categories ?? []).some((c) => c.label === text)) {
        throw new AnnotationValueError(`"${text}" is not one of: ${(config.categories ?? []).map((c) => c.label).join(", ")}`);
      }
      return text;
    }
  }
}
