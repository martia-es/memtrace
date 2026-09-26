import { TraceNotFoundError, ValidationError } from "@/domain/errors";
import { chooseBucketSeconds, fillTimeseries, type MetricsOverview } from "@/domain/metrics";
import { resolveTimeRange } from "@/domain/time-range";
import type { Page, PageCursor, TraceDetail, TraceSummary } from "@/domain/trace";
import { buildTraceDetail } from "@/domain/tree";
import type { TraceRepository } from "./ports/trace-repository";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_SPANS_PER_TRACE = 5000;

export interface ListTracesInput {
  from?: Date;
  to?: Date;
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  limit?: number;
  cursor?: PageCursor;
}

/** Casos de uso de consulta. Los adapters de entrada solo hablan con esta clase. */
export class TraceQueryService {
  constructor(
    private readonly repository: TraceRepository,
    private readonly now: () => number = Date.now,
  ) {}

  listTraces(input: ListTracesInput): Promise<Page<TraceSummary>> {
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError("Invalid limit", { limit: `must be an integer between 1 and ${MAX_PAGE_SIZE}` });
    }
    const range = resolveTimeRange(input, this.now());
    return this.repository.listTraces({
      ...range,
      service: input.service,
      status: input.status,
      hasErrors: input.hasErrors,
      minDurationMs: input.minDurationMs,
      limit,
      cursor: input.cursor,
    });
  }

  async getTrace(traceId: string): Promise<TraceDetail> {
    const found = await this.repository.getTraceSpans(traceId, MAX_SPANS_PER_TRACE);
    if (!found || found.spans.length === 0) throw new TraceNotFoundError(traceId);
    return buildTraceDetail(traceId, found.spans, found.truncated);
  }

  async getOverview(input: { from?: Date; to?: Date; service?: string }): Promise<MetricsOverview & { fromMs: number; toMs: number }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const bucketSeconds = chooseBucketSeconds(fromMs, toMs);
    const overview = await this.repository.getOverview({ fromMs, toMs, service: input.service, bucketSeconds });
    return {
      ...overview,
      bucketSeconds, // el servicio es la autoridad: la serie rellena y el valor anunciado deben coincidir
      timeseries: fillTimeseries(overview.timeseries, fromMs, toMs, bucketSeconds),
      fromMs,
      toMs,
    };
  }

  listServices(input: { from?: Date; to?: Date }): Promise<string[]> {
    return this.repository.listServices(resolveTimeRange(input, this.now()));
  }

  ping(): Promise<void> {
    return this.repository.ping();
  }
}
