import { RepositoryUnavailableError } from "@/application/errors";
import type { TraceQueryService } from "@/application/trace-query-service";
import { TraceNotFoundError, ValidationError } from "@/domain/errors";
import type { ServicesResponse } from "./contract";
import { toOverviewResponse, toTraceDetailResponse, toTraceListResponse } from "./mappers";
import { json, problem } from "./problem";
import {
  decodeCursor,
  listTracesQuery,
  overviewQuery,
  parseOrThrow,
  queryToObject,
  servicesQuery,
  traceIdParam,
} from "./schemas";

/** Traduce los errores de la aplicación a respuestas RFC 7807; nada interno llega al cliente. */
async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError) return problem(400, "Bad Request", error.message, error.fields);
    if (error instanceof TraceNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof RepositoryUnavailableError) return problem(503, "Service Unavailable", error.message);
    console.error("[memtrace-api] Unhandled error:", error);
    return problem(500, "Internal Server Error");
  }
}

const query = (request: Request) => queryToObject(new URL(request.url).searchParams);

export function createHandlers(service: TraceQueryService) {
  return {
    listTraces: (request: Request) =>
      guard(async () => {
        const { cursor, ...filters } = parseOrThrow(listTracesQuery, query(request));
        const page = await service.listTraces({ ...filters, cursor: cursor ? decodeCursor(cursor) : undefined });
        return json(toTraceListResponse(page));
      }),

    getTrace: (_request: Request, rawTraceId: string) =>
      guard(async () => {
        const traceId = parseOrThrow(traceIdParam, rawTraceId, "traceId");
        return json(toTraceDetailResponse(await service.getTrace(traceId)));
      }),

    overview: (request: Request) =>
      guard(async () => json(toOverviewResponse(await service.getOverview(parseOrThrow(overviewQuery, query(request)))))),

    services: (request: Request) =>
      guard(async () => {
        const items = await service.listServices(parseOrThrow(servicesQuery, query(request)));
        return json({ items } satisfies ServicesResponse);
      }),

    /** liveness: no toca el almacén */
    health: async () => json({ status: "ok" }),

    /** readiness: comprueba que el almacén responde */
    ready: () =>
      guard(async () => {
        await service.ping();
        return json({ status: "ok" });
      }),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
