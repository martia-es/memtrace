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
  roots: SpanNode[];
}

/** Posición en el listado (keyset): estable ante inserciones concurrentes. */
export interface PageCursor {
  startTimeUs: number;
  traceId: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: PageCursor | null;
}
