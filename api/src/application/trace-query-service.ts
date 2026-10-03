import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import { ConversationNotFoundError, TraceNotFoundError, ValidationError } from "@/domain/errors";
import {
  chooseBucketSeconds,
  fillTimeseries,
  type AttributeKeyCount,
  type AttributeValueCount,
  type CustomMetricDefinition,
  type CustomMetricResult,
  type MetricsOverview,
  type ServiceUsage,
  type StepKindCount,
} from "@/domain/metrics";
import { MAX_RANGE_MS, resolveTimeRange } from "@/domain/time-range";
import { toSpanRow, type SpanCursor, type SpanRow } from "@/domain/span-row";
import { buildTranscript, type Transcript } from "@/domain/transcript";
import type { Page, PageCursor, TraceDetail, TraceSummary } from "@/domain/trace";
import { buildTraceDetail } from "@/domain/tree";
import { costOf, toPricingCatalog, type ModelPricing, type PricingCatalog } from "@/domain/pricing";
import { telemetryOf, type ItemTelemetry } from "@/domain/evaluation";
import type { TraceRepository } from "./ports/trace-repository";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_SPANS_PER_TRACE = 5000;
/** El catálogo de precios (ADR-025) se sincroniza una vez al día: cachearlo en memoria evita una consulta extra por request. */
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
/** Más bajo que `MAX_SPANS_PER_TRACE`: la vista de árbol de conversación carga varias trazas a la vez. */
export const MAX_SPANS_PER_TRACE_IN_TREE = 2000;
export const MAX_CHAT_SPANS_PER_TRANSCRIPT = 500;

export interface ListTracesInput {
  from?: Date;
  to?: Date;
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  conversationId?: string;
  limit?: number;
  cursor?: PageCursor;
}

export interface ListConversationsInput {
  from?: Date;
  to?: Date;
  service?: string;
  hasErrors?: boolean;
  limit?: number;
  cursor?: ConversationCursor;
}

export interface ListSpansInput {
  from?: Date;
  to?: Date;
  service?: string;
  kind?: string;
  model?: string;
  status?: "ok" | "error";
  text?: string;
  conversationId?: string;
  limit?: number;
  cursor?: SpanCursor;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  turns: Page<TraceSummary>;
}

/** Casos de uso de consulta. Los adapters de entrada solo hablan con esta clase. */
export class TraceQueryService {
  private pricingCache: { atMs: number; catalog: PricingCatalog } | null = null;

  constructor(
    private readonly repository: TraceRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private async pricingCatalog(): Promise<PricingCatalog> {
    const nowMs = this.now();
    if (this.pricingCache && nowMs - this.pricingCache.atMs < PRICING_CACHE_TTL_MS) return this.pricingCache.catalog;
    const catalog = toPricingCatalog(await this.repository.getModelPricing());
    this.pricingCache = { atMs: nowMs, catalog };
    return catalog;
  }

  /** Catálogo de precios completo, para la vista de precios por modelo (ADR-025). */
  listModelPricing(): Promise<ModelPricing[]> {
    return this.repository.getModelPricing();
  }

  private pageSize(value: number | undefined): number {
    const limit = value ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError("Invalid limit", { limit: `must be an integer between 1 and ${MAX_PAGE_SIZE}` });
    }
    return limit;
  }

  listConversations(input: ListConversationsInput): Promise<Page<ConversationSummary, ConversationCursor>> {
    return this.repository.listConversations({
      ...resolveTimeRange(input, this.now()),
      service: input.service,
      hasErrors: input.hasErrors,
      limit: this.pageSize(input.limit),
      cursor: input.cursor,
    });
  }

  /** Resumen de la conversación + sus turnos en orden cronológico (paginados). */
  async getConversation(conversationId: string, input: { limit?: number; cursor?: PageCursor } = {}): Promise<ConversationDetail> {
    const limit = this.pageSize(input.limit);
    const toMs = this.now();
    const range = { fromMs: toMs - MAX_RANGE_MS, toMs };
    const [conversation, turns] = await Promise.all([
      this.repository.getConversation(conversationId, range),
      this.repository.listTraces({ ...range, conversationId, order: "asc", limit, cursor: input.cursor }),
    ]);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return { conversation, turns };
  }

  /** Mensajes usuario/asistente de cada turno; solo hay contenido si el agente lo capturó (ADR-004). */
  async getTranscript(conversationId: string): Promise<Transcript> {
    const toMs = this.now();
    const range = { fromMs: toMs - MAX_RANGE_MS, toMs };
    const [conversation, messages] = await Promise.all([
      this.repository.getConversation(conversationId, range),
      this.repository.getConversationMessages(conversationId, range, MAX_CHAT_SPANS_PER_TRANSCRIPT),
    ]);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return buildTranscript(conversationId, messages.records, messages.truncated);
  }

  async listSpans(input: ListSpansInput): Promise<Page<SpanRow, SpanCursor>> {
    const { from, to, limit, ...filters } = input;
    const [page, pricing] = await Promise.all([
      this.repository.listSpans({ ...filters, ...resolveTimeRange({ from, to }, this.now()), limit: this.pageSize(limit) }),
      this.pricingCatalog(),
    ]);
    return { items: page.items.map((record) => toSpanRow(record, pricing)), nextCursor: page.nextCursor };
  }

  listTraces(input: ListTracesInput): Promise<Page<TraceSummary>> {
    const limit = this.pageSize(input.limit);
    const range = resolveTimeRange(input, this.now());
    return this.repository.listTraces({
      ...range,
      service: input.service,
      status: input.status,
      hasErrors: input.hasErrors,
      minDurationMs: input.minDurationMs,
      conversationId: input.conversationId,
      limit,
      cursor: input.cursor,
    });
  }

  async getTrace(traceId: string): Promise<TraceDetail> {
    const [found, pricing] = await Promise.all([this.repository.getTraceSpans(traceId, MAX_SPANS_PER_TRACE), this.pricingCatalog()]);
    if (!found || found.spans.length === 0) throw new TraceNotFoundError(traceId);
    return buildTraceDetail(traceId, found.spans, found.truncated, pricing);
  }

  /** Árbol de spans de cada turno de la conversación, en el mismo orden y página que `getConversation`. */
  async getConversationTraceTrees(conversationId: string, input: { limit?: number; cursor?: PageCursor } = {}): Promise<Page<TraceDetail>> {
    const limit = this.pageSize(input.limit);
    const toMs = this.now();
    const range = { fromMs: toMs - MAX_RANGE_MS, toMs };
    const [conversation, turns] = await Promise.all([
      this.repository.getConversation(conversationId, range),
      this.repository.listTraces({ ...range, conversationId, order: "asc", limit, cursor: input.cursor }),
    ]);
    if (!conversation) throw new ConversationNotFoundError(conversationId);

    const traceIds = turns.items.map((t) => t.traceId);
    const [byTraceId, pricing] = await Promise.all([
      this.repository.getTraceSpansForTraces(traceIds, MAX_SPANS_PER_TRACE_IN_TREE),
      this.pricingCatalog(),
    ]);
    const items = traceIds
      .map((traceId) => ({ traceId, found: byTraceId.get(traceId) }))
      .filter(({ found }) => found && found.spans.length > 0)
      .map(({ traceId, found }) => buildTraceDetail(traceId, found!.spans, found!.truncated, pricing));
    return { items, nextCursor: turns.nextCursor };
  }

  /** Latencia, tokens y coste de las trazas dadas (items de una run de evaluación, ADR-044). Las que no existen (aún o ya expiradas) no aparecen. */
  async getItemTelemetry(traceIds: string[]): Promise<Map<string, ItemTelemetry>> {
    const unique = [...new Set(traceIds)];
    if (unique.length === 0) return new Map();
    const [stats, pricing] = await Promise.all([this.repository.getTraceStatsForTraces(unique), this.pricingCatalog()]);
    return new Map([...stats].map(([traceId, s]) => [traceId, telemetryOf(s, pricing)]));
  }

  async getOverview(input: { from?: Date; to?: Date; service?: string }): Promise<MetricsOverview & { fromMs: number; toMs: number }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const bucketSeconds = chooseBucketSeconds(fromMs, toMs);
    const [overview, pricing] = await Promise.all([
      this.repository.getOverview({ fromMs, toMs, service: input.service, bucketSeconds }),
      this.pricingCatalog(),
    ]);
    // el repositorio no conoce precios (ADR-025): el coste por modelo se calcula aquí, y el total es su suma
    const byModel = overview.byModel.map((m) => ({ ...m, costUsd: costOf(m.model, m.inputTokens, m.outputTokens, pricing) }));
    const totalCostUsd = byModel.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
    return {
      ...overview,
      byModel,
      totals: { ...overview.totals, costUsd: totalCostUsd },
      bucketSeconds, // el servicio es la autoridad: la serie rellena y el valor anunciado deben coincidir
      timeseries: fillTimeseries(overview.timeseries, fromMs, toMs, bucketSeconds),
      fromMs,
      toMs,
    };
  }

  listServices(input: { from?: Date; to?: Date }): Promise<string[]> {
    return this.repository.listServices(resolveTimeRange(input, this.now()));
  }

  async getUsageByServices(serviceNames: string[], input: { from?: Date; to?: Date }): Promise<{ fromMs: number; toMs: number; items: ServiceUsage[] }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const items = await this.repository.getUsageByServices(serviceNames, { fromMs, toMs });
    return { fromMs, toMs, items };
  }

  ping(): Promise<void> {
    return this.repository.ping();
  }

  /** `memtrace.step_type` distintos vistos en el rango, para el selector del builder de gráficos (ADR-027). */
  async getStepKinds(input: { from?: Date; to?: Date; service?: string }): Promise<{ fromMs: number; toMs: number; items: StepKindCount[] }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const items = await this.repository.getStepKinds({ fromMs, toMs, service: input.service });
    return { fromMs, toMs, items };
  }

  /** Valores distintos de un atributo, acotados a los step types dados (ADR-027): filtro/agrupación dinámicos. */
  async getAttributeValues(
    input: { from?: Date; to?: Date; service?: string; stepTypes: string[]; attribute: string },
  ): Promise<{ fromMs: number; toMs: number; items: AttributeValueCount[] }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const items = await this.repository.getAttributeValues({ fromMs, toMs, service: input.service, stepTypes: input.stepTypes, attribute: input.attribute });
    return { fromMs, toMs, items };
  }

  /** Claves de atributo vistas en los step types dados (ADR-030): alimenta los selectores de "group by"/"filter by". */
  async getAttributeKeys(
    input: { from?: Date; to?: Date; service?: string; stepTypes: string[] },
  ): Promise<{ fromMs: number; toMs: number; items: AttributeKeyCount[] }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const items = await this.repository.getAttributeKeys({ fromMs, toMs, service: input.service, stepTypes: input.stepTypes });
    return { fromMs, toMs, items };
  }

  /** Calcula un gráfico custom (ADR-027) sin persistirlo — guardarlo es responsabilidad de la identidad (Postgres). */
  async getCustomMetric(input: CustomMetricDefinition & { from?: Date; to?: Date; service?: string }): Promise<CustomMetricResult & { fromMs: number; toMs: number }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const bucketSeconds = input.chartType === "line" || input.chartType === "area" ? chooseBucketSeconds(fromMs, toMs) : undefined;
    const result = await this.repository.getCustomMetric({ ...input, fromMs, toMs, bucketSeconds });
    return { ...result, fromMs, toMs };
  }
}
