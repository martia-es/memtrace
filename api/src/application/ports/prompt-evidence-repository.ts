import type { PromptEvidenceRows } from "@/domain/prompt-evidence";
import type { TimeRange } from "@/domain/time-range";

/**
 * Modelo de lectura de la evidencia por versión de un prompt (ADR-069): cruza las trazas marcadas con ese prompt con el
 * feedback del usuario final y los scores de la evaluación offline de esas mismas trazas. ClickHouse.
 * Lanza `RepositoryUnavailableError` si el almacén no responde.
 */
export interface PromptEvidenceRepository {
  /** Agregados por versión de las trazas del servicio que usaron `promptName` en el rango. Las versiones sin tráfico no aparecen. */
  rowsFor(query: TimeRange & { service: string; promptName: string }): Promise<PromptEvidenceRows>;
}
