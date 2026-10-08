import type { PromptDetailDto, PromptSummaryDto, PromptTagEventDto, PromptVersionDto } from "@contract";

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
  /** Mueve el tag a una versión; `version = null` lo quita. Los tags de entorno exigen `prompt:promote`. */
  moveTag(promptId: string, tag: string, version: number | null, reason: string, signal?: AbortSignal): Promise<PromptTagEventDto>;
}
