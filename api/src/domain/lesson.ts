import { createHash } from "node:crypto";
import type { Permission } from "./permissions";
import { ValidationError } from "./errors";

/**
 * Lecciones de Mem (ADR-104). Una lección es una instrucción corta que el agente recibe cuando se da la situación en la que
 * antes fallaba. Una persona decide siempre: Mem propone, nunca activa.
 */

export const LESSON_STATUSES = ["proposed", "reviewed", "approved", "obsolete", "retired", "dismissed"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export type LessonSource = "mem" | "manual";
export type VersionOrigin = "mem" | "human";
export type EvidenceKind = "failure" | "success";

/** Permiso que hace falta para pasar de un estado a otro. Lo que no está aquí no se puede hacer. */
type TransitionPermission = Extract<Permission, "lesson:review" | "lesson:approve">;

export const LESSON_TRANSITIONS: Record<LessonStatus, Partial<Record<LessonStatus, TransitionPermission>>> = {
  proposed: { reviewed: "lesson:review", dismissed: "lesson:review" },
  // devolverla a `proposed` es pedir cambios
  reviewed: { approved: "lesson:approve", proposed: "lesson:review", dismissed: "lesson:review" },
  approved: { retired: "lesson:approve", obsolete: "lesson:approve" },
  // obsoleta: el modelo o el prompt cambiaron, o dejó de dispararse. Se puede volver a revisar o retirar.
  obsolete: { proposed: "lesson:review", retired: "lesson:approve" },
  // descartada: Mem no la vuelve a proponer (su huella sigue ocupada), pero una persona puede reabrirla
  dismissed: { proposed: "lesson:review" },
  retired: {},
};

/** Estados en los que se puede editar el texto. Editar devuelve la lección a `proposed`. */
export const EDITABLE_STATUSES: readonly LessonStatus[] = ["proposed", "reviewed", "approved", "obsolete"];

export function requiredPermission(from: LessonStatus, to: LessonStatus): TransitionPermission | null {
  return LESSON_TRANSITIONS[from][to] ?? null;
}

export const MAX_TITLE = 120;
export const MAX_SITUATION = 400;
export const MAX_FAILURE = 400;
/** Es lo único que se inyecta en el agente en cada petición: tiene que ser corto. */
export const MAX_GUIDANCE = 500;
export const MAX_MESSAGE = 500;
export const MAX_COMMENT = 500;
export const MAX_MATCH_ITEMS = 10;
export const MAX_MATCH_ITEM = 100;
export const MAX_EVIDENCE = 200;
export const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** Cuándo se dispara, de forma determinista: sin embeddings por petición. Al menos una condición. */
export interface LessonMatch {
  tools?: string[];
  errorCategories?: string[];
  intents?: string[];
}

export interface LessonContent {
  title: string;
  /** cuándo aplica: contexto para quien revisa, no se inyecta */
  situation: string;
  /** qué falla: contexto para quien revisa, no se inyecta */
  failure: string;
  /** lo que recibe el agente */
  guidance: string;
  match: LessonMatch;
}

export interface Lesson {
  id: string;
  experimentId: string;
  status: LessonStatus;
  source: LessonSource;
  fingerprint: string | null;
  currentVersion: number;
  /** lo medido cuando Mem la propuso (soporte, fallos, valor p, regla) */
  originMetrics: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LessonVersion extends LessonContent {
  id: string;
  lessonId: string;
  version: number;
  contentHash: string;
  origin: VersionOrigin;
  message: string;
  createdBy: string | null;
  createdAt: string;
}

export interface LessonActivation {
  lessonId: string;
  environment: string;
  /** versión aprobada que se sirve en ese entorno */
  version: number;
  activatedBy: string | null;
  activatedAt: string;
}

export interface LessonEvidence {
  traceId: string;
  kind: EvidenceKind;
  addedAt: string;
}

export type LessonEventKind = "created" | "version" | "transition" | "activate" | "deactivate";

export interface LessonEvent {
  id: string;
  lessonId: string;
  kind: LessonEventKind;
  fromStatus: LessonStatus | null;
  toStatus: LessonStatus | null;
  version: number | null;
  environment: string | null;
  actorId: string | null;
  actorLabel: string;
  comment: string;
  at: string;
}

/** Lo que el repositorio necesita para crear o versionar; el servicio ya lo validó. */
export interface NewLesson {
  experimentId: string;
  source: LessonSource;
  fingerprint: string | null;
  originMetrics: Record<string, unknown>;
  createdBy: string | null;
  actorLabel: string;
}

export interface NewLessonVersion extends LessonContent {
  lessonId: string;
  contentHash: string;
  origin: VersionOrigin;
  message: string;
  createdBy: string | null;
  actorLabel: string;
}

export interface LessonSummary {
  lesson: Lesson;
  /** el texto vigente (versión actual) */
  current: LessonVersion;
  /** entornos en los que está activa */
  environments: string[];
}

function bounded(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const text = value.trim();
  if (required && text.length === 0) throw new ValidationError(`${field} must not be empty`);
  if (text.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return text;
}

function matchList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`match.${field} must be a list`);
  const items = value.map((v) => bounded(v, `match.${field} item`, MAX_MATCH_ITEM, true));
  if (items.length > MAX_MATCH_ITEMS) throw new ValidationError(`match.${field} must have at most ${MAX_MATCH_ITEMS} items`);
  const unique = [...new Set(items)];
  return unique.length === 0 ? undefined : unique;
}

/** Valida y normaliza el texto de una lección (recorta, acota y exige al menos una condición de disparo). */
export function validateContent(input: { title: unknown; situation?: unknown; failure?: unknown; guidance: unknown; match: unknown }): LessonContent {
  const raw = input.match;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ValidationError("match must be an object");
  const m = raw as Record<string, unknown>;
  const match: LessonMatch = {};
  const tools = matchList(m.tools, "tools");
  const errorCategories = matchList(m.errorCategories, "errorCategories");
  const intents = matchList(m.intents, "intents");
  if (tools) match.tools = tools;
  if (errorCategories) match.errorCategories = errorCategories;
  if (intents) match.intents = intents;
  if (Object.keys(match).length === 0) throw new ValidationError("match needs at least one tool, error category or intent");
  return {
    title: bounded(input.title, "title", MAX_TITLE, true),
    situation: bounded(input.situation ?? "", "situation", MAX_SITUATION, false),
    failure: bounded(input.failure ?? "", "failure", MAX_FAILURE, false),
    guidance: bounded(input.guidance, "guidance", MAX_GUIDANCE, true),
    match,
  };
}

export function validateMessage(value: unknown, field = "message", max = MAX_MESSAGE): string {
  return bounded(value ?? "", field, max, false);
}

export function validateEnvironment(value: unknown): string {
  if (typeof value !== "string" || !ENVIRONMENT_PATTERN.test(value)) throw new ValidationError("environment is not a valid key");
  return value;
}

/** Hash del contenido que importa (no del mensaje): dos versiones con el mismo texto tienen el mismo hash. */
export function contentHash(content: LessonContent): string {
  const sorted = (xs?: string[]) => (xs ? [...xs].sort() : []);
  const canonical = JSON.stringify([content.title, content.situation, content.failure, content.guidance, sorted(content.match.tools), sorted(content.match.errorCategories), sorted(content.match.intents)]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Huella de un hallazgo de Mem: estable entre pasadas, para no volver a proponer lo ya visto ni lo descartado. */
export function findingFingerprint(experimentId: string, findingId: string): string {
  return createHash("sha256").update(`${experimentId}\u0000${findingId}`).digest("hex").slice(0, 32);
}

/** ¿Está esta lección sirviéndose a un agente? Aprobada y activada en algún entorno. */
export const isServable = (status: LessonStatus, environments: string[]): boolean => status === "approved" && environments.length > 0;
