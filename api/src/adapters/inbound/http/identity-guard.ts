import { RepositoryUnavailableError } from "@/application/errors";
import {
  AnnotationForbiddenError,
  AssistantInvariantError,
  AssistantUpstreamError,
  AssistantNotFoundError,
  AnnotationQueueInvariantError,
  AnnotationQueueNotFoundError,
  AnnotationQueueReviewerError,
  AnnotationValueError,
  DatasetRunNotFoundError,
  ScoreConfigInvariantError,
  ScoreConfigNotFoundError,
  ScoreConfigShapeError,
  SpanNotFoundError,
  TraceNotFoundError,
  ValidationError,
} from "@/domain/errors";
import { problem } from "./problem";

/** Igual que `guard` en handlers.ts, pero solo para los casos de error que usan las rutas de identidad. */
export async function identityGuard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TraceNotFoundError || error instanceof SpanNotFoundError || error instanceof DatasetRunNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof AnnotationValueError) return problem(422, "Unprocessable Entity", error.message, { value: error.message });
    if (error instanceof AnnotationForbiddenError) return problem(403, "Forbidden", error.message);
    if (error instanceof RepositoryUnavailableError) return problem(503, "Service Unavailable", error.message);
    if (error instanceof AnnotationQueueNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof AnnotationQueueReviewerError) return problem(403, "Forbidden", error.message);
    if (error instanceof AnnotationQueueInvariantError) return problem(409, "Conflict", error.message);
    if (error instanceof ScoreConfigNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof ScoreConfigInvariantError) return problem(409, "Conflict", error.message);
    if (error instanceof ScoreConfigShapeError) return problem(422, "Unprocessable Entity", error.message, error.fields);
    if (error instanceof AssistantNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof AssistantInvariantError) return problem(409, "Conflict", error.message);
    if (error instanceof AssistantUpstreamError) return problem(502, "Bad Gateway", error.message);
    if (error instanceof ValidationError) return problem(400, "Bad Request", error.message, error.fields);
    console.error("[memtrace-api] Unhandled identity error:", error);
    return problem(500, "Internal Server Error");
  }
}
