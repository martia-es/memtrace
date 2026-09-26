import type { OverviewResponse, ServicesResponse, SpanNodeDto, TraceDetailResponse, TraceListResponse, TraceSummaryDto } from "@contract";
import type { ListTracesParams, RangeParams, TraceApi } from "@/application/trace-api";

export function summary(overrides: Partial<TraceSummaryDto> = {}): TraceSummaryDto {
  return {
    traceId: "a".repeat(32),
    rootSpanName: "agente",
    serviceName: "svc",
    startTime: new Date().toISOString(),
    durationMs: 120,
    status: "ok",
    spanCount: 3,
    errorCount: 0,
    totalTokens: 0,
    ...overrides,
  };
}

export function node(overrides: Partial<SpanNodeDto> = {}): SpanNodeDto {
  return {
    spanId: "s1",
    parentSpanId: null,
    name: "span",
    kind: "chain",
    serviceName: "svc",
    startTime: "2026-09-26T12:00:00.000Z",
    offsetMs: 0,
    durationMs: 10,
    status: { code: "ok", message: null },
    orphan: false,
    genAi: null,
    content: null,
    attributes: {},
    events: [],
    children: [],
    ...overrides,
  };
}

/** Implementación en memoria del puerto: prueba la UI sin red. */
export class FakeTraceApi implements TraceApi {
  pages: TraceListResponse[] = [{ items: [], nextCursor: null }];
  listCalls: ListTracesParams[] = [];
  detail: TraceDetailResponse | Error | null = null;
  services = ["svc-a", "svc-b"];
  overview: OverviewResponse | null = null;

  async listTraces(params: ListTracesParams) {
    this.listCalls.push(params);
    const index = params.cursor ? Number(params.cursor) : 0;
    return this.pages[index] ?? { items: [], nextCursor: null };
  }
  traceCalls = 0;
  async getTrace() {
    this.traceCalls += 1;
    if (this.detail instanceof Error) throw this.detail;
    if (!this.detail) throw new Error("no detail configured");
    return this.detail;
  }
  async getOverview(_p: RangeParams & { service?: string }) {
    if (!this.overview) throw new Error("no overview configured");
    return this.overview;
  }
  async listServices(_p: RangeParams): Promise<ServicesResponse> {
    return { items: this.services };
  }
}
