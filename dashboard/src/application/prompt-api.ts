import type { PromptDetailDto, PromptEvidenceResponse, PromptGateDto, PromptPlaygroundResponse, PromptPolicyDto, PromptSummaryDto, PromptTagEventDto, PromptVersionDto } from "@contract";

/** Puerto de salida: registro de prompts (ADR-067). */

export interface NewPromptInput {
  /** `fragment`: texto compartido que otros prompts incluyen con `{{> nombre@tag}}` (ADR-073) */
  kind?: "prompt" | "fragment";
  name: string;
  description: string;
  content: string;
  message: string;
  /** agentes adicionales al actual (un prompt puede ser de varios) */
  experimentIds?: string[];
}

export interface PromptApi {
  /** Prompts del agente (los de la organización asociados a él). */
  listForAgent(experimentId: string, includeArchived: boolean, signal?: AbortSignal): Promise<PromptSummaryDto[]>;
  /** Crea el prompt con su versión 1, asociado a este agente. */
  create(experimentId: string, input: NewPromptInput, signal?: AbortSignal): Promise<PromptDetailDto>;
  get(promptId: string, signal?: AbortSignal): Promise<PromptDetailDto>;
  update(promptId: string, patch: { description?: string; archived?: boolean; experimentIds?: string[] }, signal?: AbortSignal): Promise<PromptDetailDto>;
  /**
   * Guarda una versión. Con `draft` queda como borrador (ADR-072): se puede probar y evaluar, pero no recibe tags hasta
   * publicarse. `origin` recuerda el fallo que se quería arreglar.
   */
  saveVersion(
    promptId: string,
    input: { content: string; message: string; parentVersion?: number | null; draft?: boolean; origin?: { traceIds: string[]; cause: string | null; rationale: string } | null },
    signal?: AbortSignal,
  ): Promise<PromptVersionDto>;
  /** Vuelve a resolver los fragmentos de la última versión publicada y guarda el resultado como BORRADOR (ADR-073). */
  rebuild(promptId: string, signal?: AbortSignal): Promise<PromptVersionDto>;
  /** Un fragmento cambió: reconstruye como borradores los prompts que lo usan y se han quedado atrás. */
  rebuildDependents(promptId: string, signal?: AbortSignal): Promise<{ created: Array<{ promptId: string; name: string; version: number }>; skipped: Array<{ promptId: string; name: string; reason: string }> }>;
  /** Publica un borrador: pasa a ser una versión normal que ya puede recibir tags. Lo decide una persona. */
  publishDraft(promptId: string, version: number, signal?: AbortSignal): Promise<PromptVersionDto>;
  /** Descarta un borrador. Una versión publicada no se borra nunca. */
  discardDraft(promptId: string, version: number, signal?: AbortSignal): Promise<void>;
  /** Qué pasó en las trazas que usaron cada versión del prompt (coste, errores, latencia, feedback, scores) en el rango (ADR-069). */
  getEvidence(experimentId: string, promptId: string, range: { from: Date; to: Date }, signal?: AbortSignal): Promise<PromptEvidenceResponse>;
  /**
   * Mueve el tag a una versión; `version = null` lo quita. Los tags de entorno exigen `prompt:promote`. Con una política
   * (ADR-070) los entornos protegidos exigen una evaluación exitosa; `bypassReason` se salta ese gate (exige gobernanza).
   */
  moveTag(promptId: string, tag: string, version: number | null, reason: string, bypassReason?: string | null, signal?: AbortSignal): Promise<PromptTagEventDto>;
  /**
   * Prueba una versión en el asistente real, sin mover ningún tag (ADR-071). Ejecuta el agente de verdad, solo en entornos que
   * no son de producción. `applied: false` = el agente respondió sin aplicar la versión: la respuesta no es suya.
   */
  runPlayground(experimentId: string, promptId: string, input: { deploymentId: string; version: number; message: string }, signal?: AbortSignal): Promise<PromptPlaygroundResponse>;
  /** ¿Puede ese tag apuntar a esa versión? Veredicto del gate de promoción y por qué (ADR-070). */
  previewGate(promptId: string, tag: string, version: number, signal?: AbortSignal): Promise<PromptGateDto>;
  /** Crea o cambia la política de promoción: dataset de evaluación y runs seguidos que deben pasar. */
  setPolicy(promptId: string, policy: { datasetId: string; requiredRuns: number }, signal?: AbortSignal): Promise<PromptPolicyDto>;
  /** Quita la política: cualquier versión puede promoverse. */
  deletePolicy(promptId: string, signal?: AbortSignal): Promise<void>;
}
