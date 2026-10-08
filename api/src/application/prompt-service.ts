import { createHash } from "node:crypto";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError, ValidationError } from "@/domain/errors";
import {
  MAX_DESCRIPTION,
  extractVariables,
  isEnvironmentTag,
  validateContent,
  validateMessage,
  validatePromptName,
  validateTag,
  type Prompt,
  type PromptSummary,
  type PromptTag,
  type PromptTagEvent,
  type PromptVersion,
} from "@/domain/prompt";

export interface PromptDetail {
  prompt: Prompt;
  versions: PromptVersion[];
  tags: PromptTag[];
  events: PromptTagEvent[];
  /** claves de entorno de la organización: los tags con ese nombre solo los mueve quien tiene `prompt:promote` */
  environmentKeys: string[];
}

const EVENTS_LIMIT = 100;

const hash = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Registro de prompts (ADR-067): el prompt es de la organización y puede pertenecer a varios agentes; cada guardado es
 * una versión inmutable; los tags (dev/pre/pro u otros) son punteros móviles con historial. La autorización (quién puede
 * leer, escribir o promover) la decide la ruta; aquí solo se aplican las reglas del dominio.
 */
export class PromptService {
  constructor(private readonly repo: PromptRepository) {}

  async create(
    organizationId: string,
    userId: string,
    input: { name: string; description?: string; experimentIds?: string[]; content: string; message?: string },
  ): Promise<PromptDetail> {
    const name = validatePromptName(input.name);
    const description = this.description(input.description ?? "");
    const content = validateContent(input.content);
    const experimentIds = await this.agentsOfOrganization(organizationId, input.experimentIds ?? []);
    const { prompt } = await this.repo.create(
      { organizationId, name, description, experimentIds, createdBy: userId },
      { content, variables: extractVariables(content), contentHash: hash(content), parentVersion: null, message: validateMessage(input.message), createdBy: userId },
    );
    return this.detail(prompt.id);
  }

  list(organizationId: string, filter: { experimentId?: string; includeArchived?: boolean } = {}): Promise<PromptSummary[]> {
    return this.repo.list(organizationId, filter);
  }

  async get(promptId: string): Promise<Prompt> {
    const prompt = await this.repo.get(promptId);
    if (!prompt) throw new PromptNotFoundError("Prompt");
    return prompt;
  }

  async detail(promptId: string): Promise<PromptDetail> {
    const prompt = await this.get(promptId);
    const [versions, tags, events, environmentKeys] = await Promise.all([
      this.repo.listVersions(promptId),
      this.repo.listTags(promptId),
      this.repo.tagEvents(promptId, EVENTS_LIMIT),
      this.repo.environmentKeys(prompt.organizationId),
    ]);
    return { prompt, versions, tags, events, environmentKeys };
  }

  /** Cambia la descripción, archiva/restaura o sustituye los agentes. Los nombres no se cambian: las versiones y las trazas los referencian. */
  async update(promptId: string, patch: { description?: string; archived?: boolean; experimentIds?: string[] }): Promise<PromptDetail> {
    const prompt = await this.get(promptId);
    if (patch.experimentIds !== undefined) await this.repo.setAgents(promptId, await this.agentsOfOrganization(prompt.organizationId, patch.experimentIds));
    if (patch.description !== undefined || patch.archived !== undefined) {
      await this.repo.update(promptId, { description: patch.description === undefined ? undefined : this.description(patch.description), archived: patch.archived });
    }
    return this.detail(promptId);
  }

  /** Guarda una versión nueva. Si el texto es idéntico al de la última, no hay nada que versionar. */
  async saveVersion(promptId: string, userId: string, input: { content: string; message?: string; parentVersion?: number | null }): Promise<PromptVersion> {
    const prompt = await this.get(promptId);
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before saving new versions");
    const content = validateContent(input.content);
    const contentHash = hash(content);
    const [latest] = await this.repo.listVersions(promptId);
    if (latest && latest.contentHash === contentHash) throw new PromptInvariantError(`No changes: the text is identical to version ${latest.version}`);
    const parentVersion = input.parentVersion === undefined ? (latest?.version ?? null) : input.parentVersion;
    if (parentVersion !== null && !(await this.repo.getVersion(promptId, parentVersion))) throw new ValidationError("Unknown parent version", { parentVersion: `Version ${parentVersion} does not exist` });
    return this.repo.addVersion({ promptId, content, variables: extractVariables(content), contentHash, parentVersion, message: validateMessage(input.message), createdBy: userId });
  }

  /** Recupera una versión por número (`3`) o por tag (`pro`). */
  async resolve(promptId: string, ref: string): Promise<PromptVersion> {
    const found = /^\d+$/.test(ref) ? await this.repo.getVersion(promptId, Number(ref)) : await this.repo.getVersionByTag(promptId, validateTag(ref));
    if (!found) throw new PromptNotFoundError(/^\d+$/.test(ref) ? `Version ${ref}` : `Tag "${ref}"`);
    return found;
  }

  /**
   * Apunta el tag a una versión (`version = null` lo quita). Los tags de entorno exigen `canPromote`; los libres, solo poder escribir.
   */
  async moveTag(promptId: string, userId: string, input: { tag: string; version: number | null; reason?: string }, canPromote: boolean): Promise<PromptTagEvent> {
    const prompt = await this.get(promptId);
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before moving tags");
    const tag = validateTag(input.tag);
    if (isEnvironmentTag(tag, await this.repo.environmentKeys(prompt.organizationId)) && !canPromote) throw new PromptPromoteForbiddenError(tag);
    const event = await this.repo.moveTag(promptId, tag, input.version, userId, validateMessage(input.reason));
    if (!event) throw new PromptNotFoundError(`Version ${input.version}`);
    return event;
  }

  private description(raw: string): string {
    const text = raw.trim();
    if (text.length > MAX_DESCRIPTION) throw new ValidationError("The description is too long", { description: `At most ${MAX_DESCRIPTION} characters` });
    return text;
  }

  private async agentsOfOrganization(organizationId: string, experimentIds: string[]): Promise<string[]> {
    const unique = [...new Set(experimentIds)];
    const valid = await this.repo.experimentsInOrganization(organizationId, unique);
    const invalid = unique.filter((id) => !valid.includes(id));
    if (invalid.length > 0) throw new PromptInvariantError("Some agents do not belong to this organization");
    return unique;
  }
}
