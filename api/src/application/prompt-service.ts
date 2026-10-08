import { createHash } from "node:crypto";
import type { PromptGatePort } from "@/application/prompt-gate-service";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { validateBypassReason } from "@/domain/deploy";
import { PromptGateBlockedError, PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError, ValidationError } from "@/domain/errors";
import { gatedEnvironments, type PromptPolicy } from "@/domain/prompt-gate";
import {
  MAX_DESCRIPTION,
  MAX_USAGE_ITEMS,
  TAG_PATTERN,
  extractVariables,
  isEnvironmentTag,
  validateContent,
  validateMessage,
  validatePromptName,
  validateTag,
  type GateRecord,
  type Prompt,
  type PromptSummary,
  type PromptTag,
  type PromptTagEvent,
  type PromptUsage,
  type PromptVersion,
  type UsageItem,
} from "@/domain/prompt";

export interface PromptDetail {
  prompt: Prompt;
  versions: PromptVersion[];
  tags: PromptTag[];
  events: PromptTagEvent[];
  /** versiones que los agentes informan estar usando (ADR-068), el más reciente primero */
  usage: PromptUsage[];
  /** claves de entorno de la organización: los tags con ese nombre solo los mueve quien tiene `prompt:promote` */
  environmentKeys: string[];
  /** entornos que exigen pasar la política para mover su tag (ADR-070): todos menos el primero */
  gatedEnvironments: string[];
  /** política de promoción del prompt; null = sin política, todo se mueve libremente */
  policy: PromptPolicy | null;
}

const EVENTS_LIMIT = 100;

const hash = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Registro de prompts (ADR-067): el prompt es de la organización y puede pertenecer a varios agentes; cada guardado es
 * una versión inmutable; los tags (dev/pre/pro u otros) son punteros móviles con historial. La autorización (quién puede
 * leer, escribir o promover) la decide la ruta; aquí solo se aplican las reglas del dominio.
 */
export class PromptService {
  constructor(
    private readonly repo: PromptRepository,
    /** gate de promoción (ADR-070); sin él, los tags se mueven sin comprobar nada */
    private readonly gate?: PromptGatePort,
  ) {}

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
    const [versions, tags, events, usage, environmentKeys, policy] = await Promise.all([
      this.repo.listVersions(promptId),
      this.repo.listTags(promptId),
      this.repo.tagEvents(promptId, EVENTS_LIMIT),
      this.repo.listUsage(promptId),
      this.repo.environmentKeys(prompt.organizationId),
      this.repo.getPolicy(promptId),
    ]);
    return { prompt, versions, tags, events, usage, environmentKeys, gatedEnvironments: gatedEnvironments(environmentKeys), policy };
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
   * Con una política (ADR-070), mover un entorno protegido a una versión exige una evaluación exitosa de ella; saltarse
   * ese gate (`bypassReason`) exige `canBypass` (gobernanza) y un motivo, que queda en el historial.
   */
  async moveTag(
    promptId: string,
    userId: string,
    input: { tag: string; version: number | null; reason?: string; bypassReason?: string | null },
    canPromote: boolean,
    canBypass = false,
  ): Promise<PromptTagEvent> {
    const prompt = await this.get(promptId);
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before moving tags");
    const tag = validateTag(input.tag);
    const isEnvironment = isEnvironmentTag(tag, await this.repo.environmentKeys(prompt.organizationId));
    if (isEnvironment && !canPromote) throw new PromptPromoteForbiddenError(tag);

    let record: GateRecord = { verdict: "not_gated", bypassed: false, bypassReason: null };
    if (isEnvironment && input.version !== null && this.gate) {
      const gate = await this.gate.check(prompt, tag, input.version);
      record = { verdict: gate.verdict, bypassed: false, bypassReason: null };
      if (!gate.allowed) {
        if (input.bypassReason === undefined || input.bypassReason === null) throw new PromptGateBlockedError(gate.reason, gate);
        if (!canBypass) throw new PromptGateBlockedError(`${gate.reason} Skipping the evaluation requires the governance permission.`, gate);
        record = { verdict: gate.verdict, bypassed: true, bypassReason: validateBypassReason(input.bypassReason) };
      }
    }
    const event = await this.repo.moveTag(promptId, tag, input.version, userId, validateMessage(input.reason), record);
    if (!event) throw new PromptNotFoundError(`Version ${input.version}`);
    return event;
  }

  /**
   * Lo que pide el SDK de un agente (ADR-068): la versión de un prompt por tag o por número. El prompt tiene que estar
   * asociado a ese agente. Un prompt archivado se sigue sirviendo —no se rompe a quien ya lo usa—, solo deja de aceptar versiones.
   */
  async resolveForAgent(experimentId: string, organizationId: string, name: string, ref: { tag?: string; version?: number }): Promise<{ prompt: Prompt; version: PromptVersion; tag: string | null }> {
    if ((ref.tag === undefined) === (ref.version === undefined)) throw new ValidationError("Ask for a tag or a version", { tag: "Send exactly one of tag or version" });
    const prompt = await this.repo.findByName(organizationId, validatePromptName(name));
    if (!prompt || !prompt.experimentIds.includes(experimentId)) throw new PromptNotFoundError(`Prompt "${name}" for this agent`);
    const tag = ref.tag === undefined ? null : validateTag(ref.tag);
    const version = tag === null ? await this.repo.getVersion(prompt.id, ref.version!) : await this.repo.getVersionByTag(prompt.id, tag);
    if (!version) throw new PromptNotFoundError(tag === null ? `Version ${ref.version} of "${name}"` : `Tag "${tag}" of "${name}"`);
    return { prompt, version, tag };
  }

  /**
   * Latido del SDK: qué versiones está usando el agente en su entorno. Lo que no encaja (prompt desconocido o de otro
   * agente, versión inexistente) se ignora en silencio: un latido nunca debe hacer fallar al agente. Devuelve cuántos se anotaron.
   */
  async recordUsage(experimentId: string, organizationId: string, environment: string, items: { name: string; tag: string | null; version: number }[]): Promise<number> {
    const env = environment.trim();
    if (env !== "" && !TAG_PATTERN.test(env)) throw new ValidationError("Invalid environment", { environment: "Use lowercase letters, digits, '_' or '-'" });
    if (items.length > MAX_USAGE_ITEMS) throw new ValidationError("Too many items", { items: `At most ${MAX_USAGE_ITEMS} per report` });
    const accepted: UsageItem[] = [];
    for (const item of items) {
      const prompt = await this.repo.findByName(organizationId, item.name);
      if (!prompt || !prompt.experimentIds.includes(experimentId)) continue;
      if (item.tag !== null && !TAG_PATTERN.test(item.tag)) continue;
      if (!(await this.repo.getVersion(prompt.id, item.version))) continue;
      accepted.push({ promptId: prompt.id, tag: item.tag ?? "", version: item.version });
    }
    if (accepted.length > 0) await this.repo.recordUsage(experimentId, env, accepted);
    return accepted.length;
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
