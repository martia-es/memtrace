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

  /**
   * De esos runs de evaluación, los que evaluaron EXACTAMENTE esta versión (ADR-070): todos sus items con traza usaron
   * `version` y ninguno otra versión del prompt. Un run mixto no demuestra nada de una versión concreta, así que se excluye.
   * El vínculo es item → traza → marca de prompt (ADR-068).
   */
  runsUsingVersion(query: { service: string; promptName: string; version: number; runIds: string[] }): Promise<string[]>;
}
