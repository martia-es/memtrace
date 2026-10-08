export class ValidationError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConversationNotFoundError extends Error {
  constructor(readonly conversationId: string) {
    super(`Conversation ${conversationId} not found`);
    this.name = "ConversationNotFoundError";
  }
}

export class TraceNotFoundError extends Error {
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} not found`);
    this.name = "TraceNotFoundError";
  }
}

/** La config pedida no existe en ese experimento (ADR-036). */
export class ScoreConfigNotFoundError extends Error {
  constructor(readonly configId: string) {
    super(`Score config ${configId} not found`);
    this.name = "ScoreConfigNotFoundError";
  }
}

/** Cambio que violaría una invariante de las score configs (tipo inmutable, solo ampliar, nombre ocupado...). HTTP 409. */
export class ScoreConfigInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreConfigInvariantError";
  }
}

/** La config no tiene una forma válida para su `dataType` (rango invertido, categorías duplicadas...). HTTP 422. */
export class ScoreConfigShapeError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ScoreConfigShapeError";
  }
}

/** El valor de una anotación no encaja con la score config (fuera de rango, no booleano, categoría desconocida). HTTP 422 (ADR-037). */
export class AnnotationValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationValueError";
  }
}

/** El span indicado no pertenece a la traza que se quiere anotar. */
export class SpanNotFoundError extends Error {
  constructor(readonly spanId: string) {
    super(`Span ${spanId} not found in this trace`);
    this.name = "SpanNotFoundError";
  }
}

/** Quien intenta retirar una anotación ajena no es admin del experimento. */
export class AnnotationForbiddenError extends Error {
  constructor(message = "Only the author or an experiment admin can retract this annotation") {
    super(message);
    this.name = "AnnotationForbiddenError";
  }
}

/** La cola (o uno de sus items) no existe en ese experimento (ADR-039). HTTP 404. */
export class AnnotationQueueNotFoundError extends Error {
  constructor(readonly queueId: string, readonly itemId?: string) {
    super(itemId ? `Item ${itemId} not found in annotation queue ${queueId}` : `Annotation queue ${queueId} not found`);
    this.name = "AnnotationQueueNotFoundError";
  }
}

/** Operación incompatible con el estado de la cola (archivada, nombre ocupado, quitar config de una cola iniciada, sin claim...). HTTP 409. */
export class AnnotationQueueInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationQueueInvariantError";
  }
}

/** El usuario no está en la lista de revisores de la cola (ADR-046). HTTP 403. */
export class AnnotationQueueReviewerError extends Error {
  constructor(readonly queueId: string) {
    super("You are not one of the reviewers assigned to this annotation queue");
    this.name = "AnnotationQueueReviewerError";
  }
}

/** El run pedido no existe en ese experimento (ADR-040). HTTP 404. */
export class DatasetRunNotFoundError extends Error {
  constructor(readonly datasetRunId: string) {
    super(`Dataset run ${datasetRunId} not found`);
    this.name = "DatasetRunNotFoundError";
  }
}

/** El asistente (o el despliegue, la conexión, el acceso) pedido no existe en ese experimento (ADR-053). */
export class AssistantNotFoundError extends Error {
  constructor(readonly what: string) {
    super(`${what} not found`);
    this.name = "AssistantNotFoundError";
  }
}

/** Operación que rompe una regla del registro de asistentes: ya está registrado, entorno repetido, entorno de otra organización… (ADR-053). */
export class AssistantInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantInvariantError";
  }
}

/** El asistente no respondió al chat de forma válida (caído, timeout, respuesta que no encaja con su contrato). Sale como 502 (ADR-055). */
export class AssistantUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantUpstreamError";
  }
}

/** El prompt (o la versión, o el tag) pedido no existe en esa organización (ADR-067). HTTP 404. */
export class PromptNotFoundError extends Error {
  constructor(readonly what: string) {
    super(`${what} not found`);
    this.name = "PromptNotFoundError";
  }
}

/** Operación que rompe una regla del registro de prompts: nombre ocupado, prompt archivado, agente de otra organización… (ADR-067). HTTP 409. */
export class PromptInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptInvariantError";
  }
}

/** El tag es de entorno (dev/pre/pro…) y quien lo mueve no tiene `prompt:promote` (ADR-067). HTTP 403. */
export class PromptPromoteForbiddenError extends Error {
  constructor(readonly tag: string) {
    super(`Moving the environment tag "${tag}" requires the prompt:promote permission`);
    this.name = "PromptPromoteForbiddenError";
  }
}

/** El voto de feedback de usuario final no es válido (ADR-062). HTTP 422. */
export class UserFeedbackValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFeedbackValueError";
  }
}

/** El gate de despliegue (ADR-064) no deja desplegar este commit. Lleva el veredicto para mostrar por qué. */
export class DeployBlockedError extends Error {
  constructor(
    message: string,
    readonly gate: unknown,
  ) {
    super(message);
    this.name = "DeployBlockedError";
  }
}

/** El proveedor de CI no está configurado en esta instalación (falta la GitHub App) o no está soportado todavía. */
export class CiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CiUnavailableError";
  }
}
