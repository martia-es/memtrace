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
}

export interface TraceListResponse {
  items: TraceSummaryDto[];
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
  roots: SpanNodeDto[];
}

export interface OverviewResponse {
  range: { from: string; to: string; bucketSeconds: number };
  totals: {
    traces: number;
    spans: number;
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
}

export interface ServicesResponse {
  items: string[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
}
