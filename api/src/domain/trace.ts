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
  truncated: boolean;
  conversationId: string | null;
  /** framework de agentes detectado en la traza, si lo hay (ADR-011) */
  framework: string | null;
  roots: SpanNode[];
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
