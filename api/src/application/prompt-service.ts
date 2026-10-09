import { createHash, randomBytes } from "node:crypto";
import type { PromptGatePort } from "@/application/prompt-gate-service";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import { validateBypassReason } from "@/domain/deploy";
import { PromptGateBlockedError, PromptInvariantError, PromptNotFoundError, PromptPromoteForbiddenError, ValidationError } from "@/domain/errors";
import { gatedEnvironments, type PromptPolicy } from "@/domain/prompt-gate";
import {
  MAX_DESCRIPTION,
  MAX_INCLUDES,
  MAX_USAGE_ITEMS,
  TAG_PATTERN,
  applyIncludes,
  extractVariables,
  findIncludes,
  hasMalformedInclude,
  includeKey,
  isEnvironmentTag,
  validateContent,
  validateMessage,
  validateOrigin,
  validatePromptName,
  validateTag,
  type GateRecord,
  type Include,
  type IncludeRef,
  type Prompt,
  type PromptKind,
  type PromptSummary,
  type PromptTag,
  type PromptTagEvent,
  type PromptUsage,
  type PromptVersion,
  type UsageItem,
} from "@/domain/prompt";

/** Token de un solo propósito para probar una versión en el asistente real (ADR-071). */
export function newOverrideToken(): string {
  return `mto_${randomBytes(32).toString("base64url")}`;
}

/** Una inclusión de la última versión publicada y a qué versión del fragmento apunta hoy su referencia. */
export interface IncludeStatus {
  name: string;
  ref: string;
  pinned: number;
  /** versión a la que resuelve la referencia ahora; null si el fragmento o el tag ya no existen */
  current: number | null;
  outdated: boolean;
}

export interface UsedBy {
  promptId: string;
  name: string;
  /** versión del prompt que incluye el fragmento */
  version: number;
  outdated: boolean;
}

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
  /** los fragmentos que incluye la última versión publicada y si alguno ha cambiado desde que se fijó (ADR-073) */
  includes: IncludeStatus[];
  /** si es un fragmento: los prompts que lo incluyen en su última versión publicada */
  usedBy: UsedBy[];
  /** política de promoción del prompt; null = sin política, todo se mueve libremente */
  policy: PromptPolicy | null;
}

const EVENTS_LIMIT = 100;

const hash = (content: string): string => createHash("sha256").update(content).digest("hex");

/** Hash con el que se guarda y se busca un token de playground: el token en claro no se guarda nunca. */
export const hashOverrideToken = (token: string): string => hash(token);

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
    input: { name: string; description?: string; experimentIds?: string[]; content: string; message?: string; kind?: PromptKind },
  ): Promise<PromptDetail> {
    const name = validatePromptName(input.name);
    const kind = input.kind ?? "prompt";
    const description = this.description(input.description ?? "");
    const written = validateContent(input.content);
    const experimentIds = await this.agentsOfOrganization(organizationId, input.experimentIds ?? []);
    const { content, source, includes } = await this.expand(organizationId, kind, written);
    const { prompt } = await this.repo.create(
      { organizationId, kind, name, description, experimentIds, createdBy: userId },
      { content, source, includes, variables: extractVariables(content), contentHash: hash(content), parentVersion: null, message: validateMessage(input.message), createdBy: userId, status: "published", origin: null },
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
    const latest = versions.find((v) => v.status === "published");
    return { prompt, versions, tags, events, usage, environmentKeys, gatedEnvironments: gatedEnvironments(environmentKeys), policy, ...(await this.fragmentLinks(prompt, latest)) };
  }

  /** Los fragmentos que incluye la última versión publicada y, si es un fragmento, los prompts que lo incluyen (ADR-073). */
  async fragmentLinks(prompt: Prompt, latest?: PromptVersion): Promise<{ includes: IncludeStatus[]; usedBy: UsedBy[] }> {
    const published = latest ?? (await this.repo.listVersions(prompt.id)).find((v) => v.status === "published");
    return {
      includes: prompt.kind === "prompt" && published ? await this.includeStatus(prompt.organizationId, published.includes) : [],
      usedBy: prompt.kind === "fragment" ? await this.usedByStatus(prompt) : [],
    };
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
  /**
   * Guarda una versión nueva. Con `draft` queda como borrador (ADR-072): se puede probar y evaluar, pero no recibe tags hasta
   * que alguien la publica. Si el texto es idéntico al de la última versión publicada o de la última guardada, no hay nada que versionar.
   */
  async saveVersion(
    promptId: string,
    userId: string,
    input: { content: string; message?: string; parentVersion?: number | null; draft?: boolean; origin?: { traceIds?: string[]; cause?: string | null; rationale?: string } | null },
  ): Promise<PromptVersion> {
    const prompt = await this.get(promptId);
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before saving new versions");
    // lo que se escribe es la FUENTE: las inclusiones se resuelven y se fijan a la versión exacta de cada fragmento (ADR-073)
    const { content, source, includes } = await this.expand(prompt.organizationId, prompt.kind, validateContent(input.content));
    const contentHash = hash(content);
    const all = await this.repo.listVersions(promptId);
    const [latest] = all;
    const latestPublished = all.find((v) => v.status === "published");
    for (const same of [latest, latestPublished]) {
      if (same && same.contentHash === contentHash) throw new PromptInvariantError(`No changes: the text is identical to version ${same.version}`);
    }
    // se parte de la última versión publicada: un borrador no es base de nada hasta que se publica
    const parentVersion = input.parentVersion === undefined ? (latestPublished?.version ?? null) : input.parentVersion;
    if (parentVersion !== null && !(await this.repo.getVersion(promptId, parentVersion))) throw new ValidationError("Unknown parent version", { parentVersion: `Version ${parentVersion} does not exist` });
    return this.repo.addVersion({
      promptId, content, source, includes, variables: extractVariables(content), contentHash, parentVersion, message: validateMessage(input.message), createdBy: userId,
      status: input.draft ? "draft" : "published", origin: validateOrigin(input.origin),
    });
  }

  /**
   * Vuelve a resolver las inclusiones de la última versión publicada contra los fragmentos de hoy y guarda el resultado como
   * BORRADOR (ADR-073): un cambio en un fragmento llega a los prompts que lo usan como una propuesta que alguien revisa, nunca solo.
   */
  async rebuild(promptId: string, userId: string): Promise<PromptVersion> {
    const prompt = await this.get(promptId);
    if (prompt.kind !== "prompt") throw new PromptInvariantError("Only prompts include fragments");
    const latest = (await this.repo.listVersions(promptId)).find((v) => v.status === "published");
    if (!latest || latest.source === null) throw new PromptInvariantError("The latest version includes no fragments, so there is nothing to rebuild");
    try {
      return await this.saveVersion(promptId, userId, { content: latest.source, message: "Rebuilt with the current fragments", draft: true, parentVersion: latest.version });
    } catch (error) {
      if (error instanceof PromptInvariantError && /No changes/.test(error.message)) throw new PromptInvariantError("Already up to date: the fragments resolve to the same text");
      throw error;
    }
  }

  /**
   * Un borrador propuesto por una herramienta del equipo con la API key del agente (ADR-072): por nombre, sobre un prompt de
   * ese agente. Siempre queda como borrador: una herramienta no publica ni promueve nada.
   */
  async saveDraftForAgent(
    experimentId: string,
    organizationId: string,
    userId: string,
    input: { name: string; content: string; message?: string; basedOn?: number | null; origin?: { traceIds?: string[]; cause?: string | null; rationale?: string } | null },
  ): Promise<{ prompt: Prompt; version: PromptVersion }> {
    const prompt = await this.repo.findByName(organizationId, validatePromptName(input.name));
    if (!prompt || !prompt.experimentIds.includes(experimentId)) throw new PromptNotFoundError(`Prompt "${input.name}" for this agent`);
    const version = await this.saveVersion(prompt.id, userId, { content: input.content, message: input.message, parentVersion: input.basedOn ?? undefined, draft: true, origin: input.origin });
    return { prompt, version };
  }

  /** Publica un borrador: pasa a ser una versión normal, que ya puede recibir tags (y pasar por el gate). */
  async publishDraft(promptId: string, version: number): Promise<PromptVersion> {
    const prompt = await this.get(promptId);
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before publishing");
    const published = await this.repo.publishVersion(promptId, version);
    if (!published) throw new PromptInvariantError(`Version ${version} is not a draft`);
    return published;
  }

  /** Descarta un borrador. Una versión publicada no se borra nunca. */
  async discardDraft(promptId: string, version: number): Promise<void> {
    await this.get(promptId);
    if (!(await this.repo.deleteDraft(promptId, version))) throw new PromptInvariantError(`Version ${version} is not a draft, and published versions are never deleted`);
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
    if (input.version !== null && (await this.repo.getVersion(promptId, input.version))?.status === "draft") {
      throw new PromptInvariantError(`v${input.version} is a draft: publish it before pointing a tag at it`);
    }
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
   * El SDK de un agente presenta el token de un override (ADR-071) en lugar de un tag: devuelve la versión del prompt para
   * ESA petición. El token tiene que ser vigente, de este agente y del prompt que se pide; si no, es como si no existiera.
   */
  async resolveOverride(experimentId: string, organizationId: string, name: string, token: string): Promise<{ prompt: Prompt; version: PromptVersion }> {
    const prompt = await this.repo.findByName(organizationId, validatePromptName(name));
    const granted = prompt && prompt.experimentIds.includes(experimentId) ? await this.repo.consumeOverride(hashOverrideToken(token), experimentId) : null;
    if (!prompt || !granted || granted.promptId !== prompt.id) throw new PromptNotFoundError("Override");
    const version = await this.repo.getVersion(prompt.id, granted.version);
    if (!version) throw new PromptNotFoundError("Override");
    return { prompt, version };
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

  /** Resuelve las inclusiones del texto escrito: devuelve el texto servido, la fuente (si hay inclusiones) y las versiones fijadas. */
  private async expand(organizationId: string, kind: PromptKind, written: string): Promise<{ content: string; source: string | null; includes: Include[] }> {
    if (hasMalformedInclude(written)) throw new ValidationError("Invalid include", { content: "Write an include as {{> name@tag}} or {{> name@3}}" });
    const wanted = findIncludes(written);
    if (wanted.length === 0) return { content: written, source: null, includes: [] };
    if (kind === "fragment") throw new ValidationError("A fragment cannot include other fragments", { content: "Fragments are flat text; only prompts include them" });
    if (wanted.length > MAX_INCLUDES) throw new ValidationError("Too many includes", { content: `At most ${MAX_INCLUDES} different fragments` });
    const resolved = new Map<string, string>();
    const includes: Include[] = [];
    for (const want of wanted) {
      const found = await this.resolveFragment(organizationId, want);
      resolved.set(includeKey(want), found.content);
      includes.push({ name: want.name, ref: want.ref, version: found.version });
    }
    return { content: validateContent(applyIncludes(written, resolved)), source: written, includes };
  }

  /** La versión publicada del fragmento a la que apunta `nombre@ref` ahora mismo. */
  private async resolveFragment(organizationId: string, want: IncludeRef): Promise<{ content: string; version: number }> {
    const fragment = await this.repo.findByName(organizationId, want.name);
    if (!fragment || fragment.kind !== "fragment") throw new ValidationError("Unknown fragment", { content: `"${want.name}" is not a fragment of this organization` });
    if (fragment.archivedAt) throw new ValidationError("Archived fragment", { content: `The fragment "${want.name}" is archived` });
    const version = /^\d+$/.test(want.ref) ? await this.repo.getVersion(fragment.id, Number(want.ref)) : await this.repo.getVersionByTag(fragment.id, want.ref);
    if (!version || version.status !== "published") throw new ValidationError("Unknown fragment version", { content: `${includeKey(want)} does not point to a published version of the fragment` });
    return { content: version.content, version: version.version };
  }

  private async includeStatus(organizationId: string, includes: Include[]): Promise<IncludeStatus[]> {
    return Promise.all(
      includes.map(async (i) => {
        // una referencia por número no se mueve; una por tag puede apuntar hoy a otra versión
        const current = /^\d+$/.test(i.ref) ? i.version : await this.resolveFragment(organizationId, i).then((r) => r.version, () => null);
        return { name: i.name, ref: i.ref, pinned: i.version, current, outdated: current !== null && current !== i.version };
      }),
    );
  }

  private async usedByStatus(fragment: Prompt): Promise<UsedBy[]> {
    const users = await this.repo.usedBy(fragment.organizationId, fragment.name);
    return Promise.all(
      users.map(async (u) => {
        const status = await this.includeStatus(fragment.organizationId, u.includes.filter((i) => i.name === fragment.name));
        return { promptId: u.promptId, name: u.name, version: u.version, outdated: status.some((s) => s.outdated) };
      }),
    );
  }

  /** Los prompts que usan este fragmento con una referencia que hoy apunta a otra versión: los candidatos a reconstruirse. */
  async outdatedDependents(fragmentId: string): Promise<UsedBy[]> {
    const fragment = await this.get(fragmentId);
    if (fragment.kind !== "fragment") throw new PromptInvariantError("Only fragments have dependents");
    return (await this.usedByStatus(fragment)).filter((u) => u.outdated);
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
