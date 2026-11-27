import type { LessonDetail, LessonRepository, NewEvidence } from "@/application/ports/lesson-repository";
import { LessonForbiddenError, LessonInvariantError, LessonNotFoundError, ValidationError } from "@/domain/errors";
import {
  LESSON_STATUSES,
  MAX_EVIDENCE,
  contentHash,
  findingFingerprint,
  requiredPermission,
  validateContent,
  validateEnvironment,
  validateMessage,
  MAX_COMMENT,
  type Lesson,
  type LessonActivation,
  type LessonStatus,
  type LessonSummary,
} from "@/domain/lesson";
import type { Permission } from "@/domain/permissions";

export interface LessonActor {
  userId: string;
  email: string;
}

const MAX_ORIGIN_METRICS_CHARS = 2000;
const TRACE_ID = /^[0-9a-f]{32}$/i;

function evidenceOf(value: unknown): NewEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("evidenceTraceIds must be a list");
  if (value.length > MAX_EVIDENCE) throw new ValidationError(`evidenceTraceIds must have at most ${MAX_EVIDENCE} items`);
  const ids = value.map((v) => {
    if (typeof v !== "string" || !TRACE_ID.test(v)) throw new ValidationError("evidenceTraceIds must be trace ids (32 hex characters)");
    return v.toLowerCase();
  });
  return [...new Set(ids)].map((traceId) => ({ traceId, kind: "failure" as const }));
}

/** Solo números y textos cortos de lo medido (soporte, fallos, valor p, regla): contexto para quien revisa, nunca contenido de usuario. */
function originMetricsOf(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ValidationError("originMetrics must be an object");
  if (JSON.stringify(value).length > MAX_ORIGIN_METRICS_CHARS) throw new ValidationError(`originMetrics must be at most ${MAX_ORIGIN_METRICS_CHARS} characters`);
  return value as Record<string, unknown>;
}

/**
 * Lo que las personas ven y cambian de las lecciones de Mem (ADR-104). Mem propone, una persona decide: aquí se aplica la tabla de
 * transiciones del dominio y el permiso que exige cada una. La ruta solo comprueba el acceso al experimento.
 */
export class LessonService {
  constructor(private readonly repo: LessonRepository) {}

  list(experimentId: string, status?: string): Promise<LessonSummary[]> {
    if (status !== undefined && !(LESSON_STATUSES as readonly string[]).includes(status)) throw new ValidationError(`status must be one of ${LESSON_STATUSES.join(", ")}`);
    return this.repo.list(experimentId, status as LessonStatus | undefined);
  }

  async get(experimentId: string, lessonId: string): Promise<LessonDetail> {
    const detail = await this.repo.get(experimentId, lessonId);
    if (!detail) throw new LessonNotFoundError("Lesson not found");
    return detail;
  }

  /** Propone una lección. Con `findingId` viene de Mem (una por hallazgo); sin él la escribe una persona. */
  async propose(experimentId: string, actor: LessonActor, body: Record<string, unknown>): Promise<LessonSummary> {
    const content = validateContent({ title: body.title, situation: body.situation, failure: body.failure, guidance: body.guidance, match: body.match });
    const findingId = body.findingId;
    if (findingId !== undefined && (typeof findingId !== "string" || findingId.length === 0 || findingId.length > 200)) throw new ValidationError("findingId must be a short string");
    const fromMem = typeof findingId === "string";
    return this.repo.create(
      {
        experimentId,
        source: fromMem ? "mem" : "manual",
        fingerprint: fromMem ? findingFingerprint(experimentId, findingId) : null,
        originMetrics: originMetricsOf(body.originMetrics),
        createdBy: actor.userId,
        actorLabel: actor.email,
      },
      { ...content, contentHash: contentHash(content), message: validateMessage(body.message) },
      evidenceOf(body.evidenceTraceIds),
    );
  }

  /** Cambia el texto: es una versión nueva, la lección vuelve a `proposed` y deja de servirse hasta que se apruebe otra vez. */
  async edit(experimentId: string, lessonId: string, actor: LessonActor, body: Record<string, unknown>): Promise<LessonSummary> {
    const content = validateContent({ title: body.title, situation: body.situation, failure: body.failure, guidance: body.guidance, match: body.match });
    const updated = await this.repo.addVersion(experimentId, lessonId, {
      ...content,
      lessonId,
      contentHash: contentHash(content),
      origin: "human",
      message: validateMessage(body.message),
      createdBy: actor.userId,
      actorLabel: actor.email,
    });
    if (!updated) throw new LessonNotFoundError("Lesson not found");
    return updated;
  }

  async transition(experimentId: string, lessonId: string, actor: LessonActor, permissions: readonly Permission[], body: Record<string, unknown>): Promise<Lesson> {
    const to = body.to;
    if (typeof to !== "string" || !(LESSON_STATUSES as readonly string[]).includes(to)) throw new ValidationError(`to must be one of ${LESSON_STATUSES.join(", ")}`);
    const comment = validateMessage(body.comment, "comment", MAX_COMMENT);
    const from = (await this.get(experimentId, lessonId)).summary.lesson.status;
    const needed = requiredPermission(from, to as LessonStatus);
    if (needed === null) throw new LessonInvariantError(`A lesson cannot go from ${from} to ${to}`);
    if (!permissions.includes(needed)) throw new LessonForbiddenError(`Missing permission: ${needed}`);
    const moved = await this.repo.transition(experimentId, lessonId, from, to as LessonStatus, { id: actor.userId, label: actor.email }, comment);
    if (!moved) throw new LessonNotFoundError("Lesson not found");
    return moved;
  }

  async activate(experimentId: string, lessonId: string, environment: unknown, actor: LessonActor): Promise<LessonActivation> {
    const activation = await this.repo.activate(experimentId, lessonId, validateEnvironment(environment), { id: actor.userId, label: actor.email });
    if (!activation) throw new LessonNotFoundError("Lesson not found");
    return activation;
  }

  async deactivate(experimentId: string, lessonId: string, environment: unknown, actor: LessonActor): Promise<void> {
    await this.get(experimentId, lessonId);
    const removed = await this.repo.deactivate(experimentId, lessonId, validateEnvironment(environment), { id: actor.userId, label: actor.email });
    if (!removed) throw new LessonNotFoundError("The lesson is not active in that environment");
  }
}
