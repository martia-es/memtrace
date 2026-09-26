import type { OverviewResponse, ServicesResponse, TraceDetailResponse, TraceListResponse } from "@contract";

export interface RangeParams {
  from: string;
  to: string;
}

export interface ListTracesParams extends RangeParams {
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  limit?: number;
  cursor?: string;
}

/** Puerto de salida: lo que el dashboard necesita del backend. Es el único acceso a datos (roadmap, pieza 5). */
export interface TraceApi {
  listTraces(params: ListTracesParams, signal?: AbortSignal): Promise<TraceListResponse>;
  getTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetailResponse>;
  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  listServices(params: RangeParams, signal?: AbortSignal): Promise<ServicesResponse>;
}

/** Error de la API (RFC 7807) o de conexión (`status === 0`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = "ApiError";
  }
}
