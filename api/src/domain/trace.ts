import type { SpanNode, StatusCode } from "./span";

/** Fila del listado: una traza identificada por su span raíz. */
export interface TraceSummary {
  traceId: string;
  rootSpanName: string;
  serviceName: string;
  startTimeUs: number;
  durationMs: number;
  /** estado del span raíz; `errorCount` dice si falló algo dentro */
  status: StatusCode;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  /** vista previa (≤ 240 caracteres) del mensaje de entrada y de salida de la traza */
  input: string | null;
  output: string | null;
  /** conversación a la que pertenece el turno (ADR-012) */
  conversationId: string | null;
}

export interface TraceDetail {
  traceId: string;
  startTimeUs: number;
  durationMs: number;
  status: StatusCode;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  /** 0 si ningún span tiene precio conocido para su modelo, no "sin datos" (ADR-025) */
  totalCostUsd: number;
  truncated: boolean;
  conversationId: string | null;
  /** framework de agentes detectado en la traza, si lo hay (ADR-011) */
  framework: string | null;
  roots: SpanNode[];
}

/** Cifras de una traza leídas del almacén, sin precios: lo que necesita una run de evaluación para mostrar latencia, tokens y coste (ADR-044). */
export interface TraceStats {
  traceId: string;
  /** duración del span raíz */
  durationMs: number;
  /** solo spans de LLM (`gen_ai.operation.name = chat`), desglosados por modelo para poder ponerles precio */
  byModel: { model: string | null; inputTokens: number; outputTokens: number }[];
}

/** Posición en el listado (keyset): estable ante inserciones concurrentes. */
export interface PageCursor {
  startTimeUs: number;
  traceId: string;
}

export interface Page<T, C = PageCursor> {
  items: T[];
  nextCursor: C | null;
}
