import type { GateRecord, NewPrompt, NewPromptVersion, Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptUsage, PromptVersion, UsageItem } from "@/domain/prompt";
import type { PromptPolicy } from "@/domain/prompt-gate";

/** Registro de prompts (ADR-067). PostgreSQL. Las versiones son inmutables: solo se añaden. */
export interface PromptRepository {
  /** Claves de los entornos de la organización (dev, pre, pro…): los tags con ese nombre son tags de entorno. */
  environmentKeys(organizationId: string): Promise<string[]>;
  /** De los experimentos dados, los que pertenecen a la organización (para rechazar agentes de otra). */
  experimentsInOrganization(organizationId: string, experimentIds: string[]): Promise<string[]>;

  /** Crea el prompt con su versión 1 en una sola transacción. Nombre ocupado en la organización -> PromptInvariantError. */
  create(input: NewPrompt, firstVersion: Omit<NewPromptVersion, "promptId">): Promise<{ prompt: Prompt; version: PromptVersion }>;
  get(promptId: string): Promise<Prompt | null>;
  /** El prompt de la organización con ese nombre (archivado o no), con sus agentes. */
  findByName(organizationId: string, name: string): Promise<Prompt | null>;
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
  moveTag(promptId: string, tag: string, version: number | null, userId: string, reason: string, gate: GateRecord): Promise<PromptTagEvent | null>;
  /** ¿Estuvo ya este tag en esta versión sin que nadie se saltara el gate? Entonces volver a ella es un rollback legítimo. */
  wasServed(promptId: string, tag: string, version: number): Promise<boolean>;

  /** Guarda el hash de un token de playground (ADR-071) atado a un agente, un prompt y una versión; olvida los caducados. */
  createOverride(input: { tokenHash: string; experimentId: string; promptId: string; version: number; userId: string; ttlSeconds: number }): Promise<void>;
  /** El agente presenta el token: devuelve a qué prompt y versión apunta si sigue vigente y es de ese agente, y lo cuenta como usado. */
  consumeOverride(tokenHash: string, experimentId: string): Promise<{ promptId: string; version: number } | null>;
  /** Cuántas veces presentó el agente el token: más de 0 demuestra que aplicó el override. */
  overrideUses(tokenHash: string): Promise<number>;

  /** Política de promoción del prompt (ADR-070), o null si no tiene. */
  getPolicy(promptId: string): Promise<PromptPolicy | null>;
  setPolicy(promptId: string, policy: { datasetId: string; requiredRuns: number }, userId: string): Promise<PromptPolicy>;
  deletePolicy(promptId: string): Promise<void>;
  tagEvents(promptId: string, limit: number): Promise<PromptTagEvent[]>;

  /** Anota (o refresca) qué versiones usa el agente en el entorno (ADR-068). Olvida lo no visto en 7 días. */
  recordUsage(experimentId: string, environment: string, items: UsageItem[]): Promise<void>;
  /** Usos informados en los últimos 7 días, el más reciente primero. */
  listUsage(promptId: string): Promise<PromptUsage[]>;
}
