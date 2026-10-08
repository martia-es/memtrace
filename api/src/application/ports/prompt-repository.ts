import type { NewPrompt, NewPromptVersion, Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptVersion } from "@/domain/prompt";

/** Registro de prompts (ADR-067). PostgreSQL. Las versiones son inmutables: solo se añaden. */
export interface PromptRepository {
  /** Claves de los entornos de la organización (dev, pre, pro…): los tags con ese nombre son tags de entorno. */
  environmentKeys(organizationId: string): Promise<string[]>;
  /** De los experimentos dados, los que pertenecen a la organización (para rechazar agentes de otra). */
  experimentsInOrganization(organizationId: string, experimentIds: string[]): Promise<string[]>;

  /** Crea el prompt con su versión 1 en una sola transacción. Nombre ocupado en la organización -> PromptInvariantError. */
  create(input: NewPrompt, firstVersion: Omit<NewPromptVersion, "promptId">): Promise<{ prompt: Prompt; version: PromptVersion }>;
  get(promptId: string): Promise<Prompt | null>;
  /** Con `experimentId` solo los prompts de ese agente. Archivados fuera salvo `includeArchived`. */
  list(organizationId: string, filter: { experimentId?: string; includeArchived?: boolean }): Promise<PromptSummary[]>;
  update(promptId: string, patch: { description?: string; archived?: boolean }): Promise<Prompt | null>;
  /** Sustituye los agentes del prompt. */
  setAgents(promptId: string, experimentIds: string[]): Promise<void>;

  /** Añade la versión siguiente (numeración por prompt, atómica). */
  addVersion(input: NewPromptVersion): Promise<PromptVersion>;
  /** Más recientes primero. */
  listVersions(promptId: string): Promise<PromptVersion[]>;
  getVersion(promptId: string, version: number): Promise<PromptVersion | null>;
  /** La versión a la que apunta el tag ahora. */
  getVersionByTag(promptId: string, tag: string): Promise<PromptVersion | null>;

  listTags(promptId: string): Promise<PromptTag[]>;
  /** Apunta el tag a una versión (o lo quita con `version = null`) y deja el evento. Devuelve null si la versión no existe. */
  moveTag(promptId: string, tag: string, version: number | null, userId: string, reason: string): Promise<PromptTagEvent | null>;
  tagEvents(promptId: string, limit: number): Promise<PromptTagEvent[]>;
}
