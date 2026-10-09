import type { PromptDetailDto, PromptEvidenceResponse, PromptGateDto, PromptPlaygroundResponse, PromptPolicyDto, PromptSummaryDto, PromptTagEventDto, PromptVersionDto } from "@contract";

/** Puerto de salida: registro de prompts (ADR-067). */

export interface NewPromptInput {
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
  saveVersion(promptId: string, input: { content: string; message: string; parentVersion?: number | null }, signal?: AbortSignal): Promise<PromptVersionDto>;
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
