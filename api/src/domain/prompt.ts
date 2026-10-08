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

export interface Prompt {
  id: string;
  organizationId: string;
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

export interface NewPrompt {
  organizationId: string;
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
}

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
