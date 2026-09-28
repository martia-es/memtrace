/**
 * Contrato HTTP/JSON de `/api/v1` (ADR-009). Es lo único que conoce el dashboard.
 * Solo se admiten cambios aditivos dentro de una versión.
 *
 * AUTOCONTENIDO a propósito: no importa nada del resto de la API, porque el dashboard lo importa
 * (solo tipos) desde `dashboard/` con un alias. Los tipos del dominio encajan estructuralmente.
 */

export type StatusCodeDto = "ok" | "error" | "unset";

export interface SpanStatusDto {
  code: StatusCodeDto;
  message: string | null;
}

export interface GenAiInfoDto {
  operation: string | null;
  provider: string | null;
  requestModel: string | null;
  responseModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  finishReasons: string[];
  temperature: number | null;
  maxTokens: number | null;
  toolName: string | null;
  toolCallId: string | null;
}

/** JSON parseado, o el string original si lo capturado no era JSON (ADR-004). */
export interface SpanContentDto {
  inputMessages?: unknown;
  outputMessages?: unknown;
  toolArguments?: unknown;
  toolResult?: unknown;
  input?: unknown;
  output?: unknown;
}

export interface TraceSummaryDto {
  traceId: string;
  rootSpanName: string;
  serviceName: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  /** vista previa (≤ 240 caracteres) del mensaje de entrada y de salida */
  input: string | null;
  output: string | null;
  /** conversación a la que pertenece el turno (ADR-012) */
  conversationId: string | null;
}

export interface TraceListResponse {
  items: TraceSummaryDto[];
  nextCursor: string | null;
}

/** Un span suelto del listado plano, con una vista previa (≤ 240 caracteres) de su entrada y salida. */
export interface SpanRowDto {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  conversationId: string | null;
  name: string;
  /** llm | tool | retriever | agent | chain | embedding | unknown */
  kind: string;
  serviceName: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  model: string | null;
  /** null si el span no es una llamada a un LLM */
  totalTokens: number | null;
  input: string | null;
  output: string | null;
}

export interface SpanListResponse {
  items: SpanRowDto[];
  nextCursor: string | null;
}

export interface SpanEventDto {
  name: string;
  time: string;
  attributes: Record<string, string>;
}

export interface SpanNodeDto {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  serviceName: string;
  startTime: string;
  offsetMs: number;
  durationMs: number;
  status: SpanStatusDto;
  orphan: boolean;
  genAi: GenAiInfoDto | null;
  content: SpanContentDto | null;
  framework: string | null;
  attributes: Record<string, string>;
  events: SpanEventDto[];
  children: SpanNodeDto[];
}

export interface TraceDetailResponse {
  traceId: string;
  startTime: string;
  durationMs: number;
  status: StatusCodeDto;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  truncated: boolean;
  conversationId: string | null;
  framework: string | null;
  roots: SpanNodeDto[];
}

/** Conversación = trazas (turnos) con el mismo `gen_ai.conversation.id` (ADR-012). */
export interface ConversationSummaryDto {
  conversationId: string;
  serviceNames: string[];
  startTime: string;
  lastActivity: string;
  turnCount: number;
  /** turnos cuyo span raíz falló */
  errorTurns: number;
  /** spans fallidos en cualquier punto de la conversación */
  failedSpans: number;
  totalTokens: number;
  /** suma de las duraciones de los turnos (sin esperas del usuario) */
  activeMs: number;
}

/** Mensajes de la conversación por turno; vacío si el agente no capturó contenido (ADR-013). */
export interface TranscriptResponse {
  conversationId: string;
  contentCaptured: boolean;
  truncated: boolean;
  turns: { traceId: string; startTime: string; model: string | null; user: string | null; assistant: string | null }[];
}

export interface ConversationListResponse {
  items: ConversationSummaryDto[];
  nextCursor: string | null;
}

/** Resumen + turnos en orden cronológico */
export interface ConversationDetailResponse extends ConversationSummaryDto {
  turns: TraceListResponse;
}

/** Árbol de spans de cada turno de la conversación, en orden cronológico (para la vista unificada). */
export interface ConversationTreeResponse {
  items: TraceDetailResponse[];
  nextCursor: string | null;
}

export interface OverviewResponse {
  range: { from: string; to: string; bucketSeconds: number };
  totals: {
    traces: number;
    spans: number;
    conversations: number;
    errorTraces: number;
    errorRate: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: { p50: number; p95: number; p99: number };
  timeseries: { bucketStart: string; traces: number; errorTraces: number; p95Ms: number; totalTokens: number }[];
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; p95Ms: number }[];
  byTool: { tool: string; calls: number; errors: number; p95Ms: number }[];
  /** vacío si el worker de temáticas (ADR-022) aún no ha corrido sobre este rango */
  byTopic: { topic: string; responses: number; avgConfidence: number }[];
}

export interface ServicesResponse {
  items: string[];
}

/** Tokens totales por experimento accesible al usuario, para la comparativa de coste entre agentes. */
export interface ExperimentUsageResponse {
  items: { experimentId: string; experimentName: string; traces: number; inputTokens: number; outputTokens: number; totalTokens: number }[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
}
