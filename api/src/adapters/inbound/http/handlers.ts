import { RepositoryUnavailableError } from "@/application/errors";
import type { TraceQueryService } from "@/application/trace-query-service";
import { ConversationNotFoundError, TraceNotFoundError, ValidationError } from "@/domain/errors";
import type { ServicesResponse } from "./contract";
import {
  toAttributeKeysResponse,
  toAttributeValuesResponse,
  toConversationDetailResponse,
  toConversationListResponse,
  toConversationTreeResponse,
  toCustomMetricResultResponse,
  toExperimentUsageResponse,
  toModelPricingResponse,
  toOverviewResponse,
  toSpanListResponse,
  toStepKindsResponse,
  toTraceDetailResponse,
  toTraceListResponse,
  toTranscriptResponse,
} from "./mappers";
import { json, problem } from "./problem";
import {
  attributeKeysQuery,
  attributeValuesQuery,
  conversationIdParam,
  customMetricQueryBody,
  decodeConversationCursor,
  decodeCursor,
  decodeSpanCursor,
  listConversationsQuery,
  listSpansQuery,
  listTracesQuery,
  overviewQuery,
  parseOrThrow,
  queryToObject,
  servicesQuery,
  stepKindsQuery,
  traceIdParam,
  turnsQuery,
  usageQuery,
} from "./schemas";

/** Traduce los errores de la aplicación a respuestas RFC 7807; nada interno llega al cliente. */
async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError) return problem(400, "Bad Request", error.message, error.fields);
    if (error instanceof TraceNotFoundError || error instanceof ConversationNotFoundError) return problem(404, "Not Found", error.message);
    if (error instanceof RepositoryUnavailableError) return problem(503, "Service Unavailable", error.message);
    console.error("[memtrace-api] Unhandled error:", error);
    return problem(500, "Internal Server Error");
  }
}

const query = (request: Request) => queryToObject(new URL(request.url).searchParams);

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

export function createHandlers(service: TraceQueryService) {
  return {
    listTraces: (request: Request) =>
      guard(async () => {
        const { cursor, ...filters } = parseOrThrow(listTracesQuery, query(request));
        const page = await service.listTraces({ ...filters, cursor: cursor ? decodeCursor(cursor) : undefined });
        return json(toTraceListResponse(page));
      }),

    listSpans: (request: Request) =>
      guard(async () => {
        const { cursor, ...filters } = parseOrThrow(listSpansQuery, query(request));
        const page = await service.listSpans({ ...filters, cursor: cursor ? decodeSpanCursor(cursor) : undefined });
        return json(toSpanListResponse(page));
      }),

    listConversations: (request: Request) =>
      guard(async () => {
        const { cursor, ...filters } = parseOrThrow(listConversationsQuery, query(request));
        const page = await service.listConversations({ ...filters, cursor: cursor ? decodeConversationCursor(cursor) : undefined });
        return json(toConversationListResponse(page));
      }),

    getConversation: (request: Request, rawConversationId: string) =>
      guard(async () => {
        const conversationId = parseOrThrow(conversationIdParam, rawConversationId, "conversationId");
        const { cursor, limit } = parseOrThrow(turnsQuery, query(request));
        const detail = await service.getConversation(conversationId, { limit, cursor: cursor ? decodeCursor(cursor) : undefined });
        return json(toConversationDetailResponse(detail.conversation, detail.turns));
      }),

    getConversationTree: (request: Request, rawConversationId: string) =>
      guard(async () => {
        const conversationId = parseOrThrow(conversationIdParam, rawConversationId, "conversationId");
        const { cursor, limit } = parseOrThrow(turnsQuery, query(request));
        const page = await service.getConversationTraceTrees(conversationId, { limit, cursor: cursor ? decodeCursor(cursor) : undefined });
        return json(toConversationTreeResponse(page));
      }),

    getTranscript: (_request: Request, rawConversationId: string) =>
      guard(async () => {
        const conversationId = parseOrThrow(conversationIdParam, rawConversationId, "conversationId");
        return json(toTranscriptResponse(await service.getTranscript(conversationId)));
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

    /** coste (tokens) por experimento accesible al usuario, para la comparativa entre agentes */
    usageByExperiments: (request: Request, experiments: { id: string; name: string; serviceName: string }[]) =>
      guard(async () => {
        const range = parseOrThrow(usageQuery, query(request));
        const { items } = await service.getUsageByServices(experiments.map((e) => e.serviceName), range);
        return json(toExperimentUsageResponse(experiments, items));
      }),

    /** catálogo de precios por modelo (ADR-025), para la vista de precios */
    modelPricing: (_request: Request) => guard(async () => json(toModelPricingResponse(await service.listModelPricing()))),

    /** `memtrace.step_type` distintos vistos en el rango, para el selector del builder de gráficos (ADR-027) */
    stepKinds: (request: Request) =>
      guard(async () => {
        const { items } = await service.getStepKinds(parseOrThrow(stepKindsQuery, query(request)));
        return json(toStepKindsResponse(items));
      }),

    /** valores distintos de un atributo, acotados a los step types dados (ADR-027) */
    attributeValues: (request: Request) =>
      guard(async () => {
        const { items } = await service.getAttributeValues(parseOrThrow(attributeValuesQuery, query(request)));
        return json(toAttributeValuesResponse(items));
      }),

    /** claves de atributo vistas en los step types dados, para los selectores de "group by"/"filter by" (ADR-030) */
    attributeKeys: (request: Request) =>
      guard(async () => {
        const { items } = await service.getAttributeKeys(parseOrThrow(attributeKeysQuery, query(request)));
        return json(toAttributeKeysResponse(items));
      }),

    /** calcula un gráfico custom sin persistirlo (ADR-027); `serviceName` lo resuelve la route desde el experimento */
    customMetricQuery: (request: Request, serviceName: string) =>
      guard(async () => {
        const input = parseOrThrow(customMetricQueryBody, await jsonBody(request));
        const result = await service.getCustomMetric({ ...input, service: serviceName });
        return json(toCustomMetricResultResponse(result));
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
