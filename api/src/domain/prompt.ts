import { ValidationError } from "./errors";

/**
 * Registro de prompts (ADR-067). Tipos del modelo y reglas puras: nombres, tags, variables `{{nombre}}` y qué tags
 * son de entorno. Sin tecnología.
 */

export const PROMPT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const TAG_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const MAX_PROMPT_CONTENT = 100_000;
export const MAX_DESCRIPTION = 2000;
export const MAX_MESSAGE = 500;

/** `fragment`: texto compartido (tono, políticas, formato) que otros prompts incluyen con `{{> nombre@tag}}` (ADR-073). */
export type PromptKind = "prompt" | "fragment";

export interface Prompt {
  id: string;
  organizationId: string;
  kind: PromptKind;
  name: string;
  description: string;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** agentes (experimentos) a los que pertenece; puede ser más de uno */
  experimentIds: string[];
}

export interface PromptSummary extends Prompt {
  latestVersion: number;
  /** tag -> número de versión al que apunta ahora */
  tags: Record<string, number>;
}

/** `draft`: propuesta pendiente de revisión; se puede probar y evaluar, pero no recibir un tag (ADR-072). */
export type VersionStatus = "draft" | "published";

/** De dónde sale una versión que no es un cambio hecho a mano: el fallo que se quería arreglar (ADR-072). */
export interface VersionOrigin {
  kind: "fix";
  /** trazas fallidas que motivaron el arreglo */
  traceIds: string[];
  /** el fallo, en una frase (mensaje del error o su causa de negocio) */
  cause: string | null;
  /** por qué este cambio debería arreglarlo, en palabras de quien (o lo que) lo propuso */
  rationale: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  content: string;
  variables: string[];
  contentHash: string;
  parentVersion: number | null;
  message: string;
  createdBy: string | null;
  createdAt: string;
  status: VersionStatus;
  origin: VersionOrigin | null;
  /** cuándo se publicó; null mientras es un borrador */
  publishedAt: string | null;
  /** lo que escribió quien la editó, con las inclusiones `{{> nombre@tag}}` sin resolver; null si no incluye nada (ADR-073) */
  source: string | null;
  /** las versiones exactas de los fragmentos con las que se resolvió `content` */
  includes: Include[];
}

/** Una inclusión resuelta y fijada: `{{> tone@pro}}` quedó en la versión 4 de `tone` (ADR-073). */
export interface Include {
  name: string;
  /** como lo escribió quien editó: un tag (`pro`) o un número (`3`) */
  ref: string;
  /** versión del fragmento con la que se resolvió al guardar */
  version: number;
}

export interface PromptTag {
  tag: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PromptTagEvent {
  id: string;
  tag: string;
  fromVersion: number | null;
  /** null = el tag se quitó */
  toVersion: number | null;
  changedBy: string | null;
  reason: string;
  createdAt: string;
  /** lo que dijo el gate de promoción (ADR-070); null en los movimientos anteriores al gate */
  gateVerdict: string | null;
  /** alguien con permiso de gobernanza se saltó el gate; `bypassReason` lo justifica */
  gateBypassed: boolean;
  bypassReason: string | null;
}

/** Cómo salió el gate al mover un tag: se guarda en el historial para que se pueda auditar. */
export interface GateRecord {
  verdict: string;
  bypassed: boolean;
  bypassReason: string | null;
}

/** Qué versión de un prompt informa un agente que está usando, y desde qué entorno (ADR-068). */
export interface PromptUsage {
  experimentId: string;
  /** vacío = el agente no declara entorno */
  environment: string;
  /** tag que sigue el agente; vacío = pidió una versión fija */
  tag: string;
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface UsageItem {
  promptId: string;
  tag: string;
  version: number;
}

/** Un uso se considera «ahora» si se informó hace menos de este tiempo: el SDK informa cada pocos minutos. */
export const USAGE_FRESH_MS = 15 * 60 * 1000;
export const MAX_USAGE_ITEMS = 50;

/** Cabecera con la que MemTrace pasa al agente el token de un override de prompt (ADR-071). */
export const PROMPT_OVERRIDE_HEADER = "x-memtrace-prompt-override";
/** Un token de playground caduca enseguida: vale para una petición, no para una sesión. */
export const OVERRIDE_TTL_SECONDS = 120;
export const MAX_PLAYGROUND_MESSAGE = 4000;
/** turnos anteriores que el playground reproduce antes del mensaje que se prueba (ADR-075) */
export const MAX_PLAYGROUND_HISTORY = 10;

export interface NewPrompt {
  organizationId: string;
  kind: PromptKind;
  name: string;
  description: string;
  experimentIds: string[];
  createdBy: string;
}

export interface NewPromptVersion {
  promptId: string;
  content: string;
  variables: string[];
  contentHash: string;
  parentVersion: number | null;
  message: string;
  createdBy: string;
  status: VersionStatus;
  origin: VersionOrigin | null;
  /** ver `PromptVersion.source`: null si no incluye nada */
  source: string | null;
  includes: Include[];
}

const TRACE_ID = /^[0-9a-f]{32}$/;
export const MAX_ORIGIN_TRACES = 10;
export const MAX_RATIONALE = 2000;

/** Valida el origen de un arreglo: pocas trazas con forma de id, y un motivo acotado. */
export function validateOrigin(raw: { traceIds?: string[]; cause?: string | null; rationale?: string } | null | undefined): VersionOrigin | null {
  if (!raw) return null;
  const traceIds = [...new Set((raw.traceIds ?? []).map((t) => t.trim().toLowerCase()))];
  if (traceIds.length > MAX_ORIGIN_TRACES || traceIds.some((t) => !TRACE_ID.test(t))) {
    throw new ValidationError("Invalid origin", { traceIds: `Up to ${MAX_ORIGIN_TRACES} trace ids of 32 hexadecimal characters` });
  }
  const rationale = (raw.rationale ?? "").trim();
  if (rationale.length > MAX_RATIONALE) throw new ValidationError("Invalid origin", { rationale: `At most ${MAX_RATIONALE} characters` });
  const cause = (raw.cause ?? "").trim().slice(0, 300);
  return { kind: "fix", traceIds, cause: cause === "" ? null : cause, rationale };
}

// ---- fragmentos (ADR-073) ----

export const MAX_INCLUDES = 20;
const INCLUDE = /\{\{>\s*([a-z0-9][a-z0-9._-]{0,63})@([a-z][a-z0-9_-]{0,31}|\d+)\s*\}\}/g;

export interface IncludeRef {
  name: string;
  ref: string;
}

const refKey = (i: IncludeRef): string => `${i.name}@${i.ref}`;

/** Las inclusiones del texto, sin repetir y en orden de aparición. */
export function findIncludes(source: string): IncludeRef[] {
  const seen = new Map<string, IncludeRef>();
  for (const m of source.matchAll(INCLUDE)) seen.set(`${m[1]}@${m[2]}`, { name: m[1]!, ref: m[2]! });
  return [...seen.values()];
}

/** ¿Hay algún `{{>` que no sea una inclusión bien escrita? Mejor un error claro que un `{{> tone}}` servido al modelo tal cual. */
export function hasMalformedInclude(source: string): boolean {
  return (source.match(/\{\{>/g) ?? []).length !== (source.match(INCLUDE) ?? []).length;
}

/** Sustituye cada inclusión por el texto del fragmento resuelto (`nombre@ref` -> contenido). Lo que se inserta no se vuelve a interpretar. */
export function applyIncludes(source: string, resolved: ReadonlyMap<string, string>): string {
  return source.replace(INCLUDE, (_all, name: string, ref: string) => resolved.get(`${name}@${ref}`) ?? "");
}

export { refKey as includeKey };

export function validatePromptName(raw: string): string {
  const name = raw.trim();
  if (!PROMPT_NAME_PATTERN.test(name)) {
    throw new ValidationError("Invalid prompt name", { name: "Use lowercase letters, digits, '.', '_' or '-' (1-64 characters, starting with a letter or digit)" });
  }
  return name;
}

export function validateTag(raw: string): string {
  const tag = raw.trim();
  if (!TAG_PATTERN.test(tag)) {
    throw new ValidationError("Invalid tag", { tag: "Use lowercase letters, digits, '_' or '-' (1-32 characters, starting with a letter)" });
  }
  return tag;
}

export function validateContent(raw: string): string {
  if (raw.trim().length === 0) throw new ValidationError("The prompt content is empty", { content: "Write the prompt text" });
  if (raw.length > MAX_PROMPT_CONTENT) throw new ValidationError("The prompt content is too long", { content: `At most ${MAX_PROMPT_CONTENT} characters` });
  return raw;
}

export function validateMessage(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (message.length > MAX_MESSAGE) throw new ValidationError("The message is too long", { message: `At most ${MAX_MESSAGE} characters` });
  return message;
}

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Variables `{{nombre}}` del texto, sin repetir y en orden de aparición. */
export function extractVariables(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(VARIABLE)) seen.add(match[1]!);
  return [...seen];
}

/** Un tag es "de entorno" cuando su nombre es la clave de un entorno de la organización (dev, pre, pro…). */
export function isEnvironmentTag(tag: string, environmentKeys: readonly string[]): boolean {
  return environmentKeys.includes(tag);
}
