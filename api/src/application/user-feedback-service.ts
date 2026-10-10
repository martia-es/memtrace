import type { TenantScope } from "@/domain/tenant";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import { isLowRating } from "@/domain/annotation";
import { SpanNotFoundError, TraceNotFoundError } from "@/domain/errors";
import type { TimeRange } from "@/domain/time-range";
import {
  feedbackAlignment,
  validateRating,
  type FeedbackAlignment,
  type FeedbackDay,
  type FeedbackRating,
  type FeedbackRatingSummary,
  type FeedbackSummary,
  type UserFeedback,
} from "@/domain/user-feedback";
import type { ScoreConfig } from "@/domain/score-config";

/** Techo de spans al comprobar que una traza (y un span) existen: el mismo que usa el detalle de traza. */
const TRACE_LOOKUP_MAX_SPANS = 5000;
/** Votos recientes que se revisan para medir la alineación, y cuántos se devuelven con detalle. */
const ALIGNMENT_SCAN_LIMIT = 500;
const RECENT_DOWN_ITEMS = 10;

export interface SubmitFeedbackInput {
  rating: number;
  comment?: string | null;
  spanId?: string | null;
  endUserId?: string | null;
  externalMessageId?: string | null;
}

export interface RetractFeedbackInput {
  spanId?: string | null;
  endUserId?: string | null;
}

export interface TraceFeedback {
  votes: UserFeedback[];
  alignment: FeedbackAlignment;
}

export interface FeedbackAlignmentCounts {
  aligned: number;
  misaligned: number;
}

export interface FeedbackOverview {
  summary: FeedbackSummary;
  days: FeedbackDay[];
  /** Trazas con voto del rango en las que usuario y revisión humana coinciden o no (sobre los últimos votos). */
  alignment: FeedbackAlignmentCounts;
  /** Trazas con 👎 más recientes. */
  recentDown: Array<{ traceId: string; comment: string | null; createdAt: string }>;
}

/**
 * Feedback del usuario final (ADR-062). Quien llama es un agente (API key) o una persona probando el chat desde el
 * dashboard: en ambos casos solo se comprueba lo que depende de los datos (la traza es del tenant, el voto es válido).
 * "Alineado" compara el voto con la revisión humana de la misma traza (anotaciones, ADR-037).
 */
export class UserFeedbackService {
  constructor(
    private readonly feedback: UserFeedbackRepository,
    private readonly annotations: AnnotationRepository,
    private readonly scoreConfigs: ScoreConfigRepository,
    private readonly traces: TraceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Crea o cambia el voto de (traza, span, usuario final). La traza debe existir bajo el servicio del experimento. */
  async submit(scope: TenantScope, traceId: string, input: SubmitFeedbackInput): Promise<UserFeedback> {
    const rating = validateRating(input.rating);
    await this.requireTraceInTenant(scope, traceId, input.spanId ?? null);
    const vote: UserFeedback = {
      traceId,
      spanId: input.spanId || null,
      rating,
      comment: input.comment?.trim() || null,
      endUserId: input.endUserId?.trim() || null,
      externalMessageId: input.externalMessageId?.trim() || null,
      createdAt: this.now().toISOString(),
    };
    await this.feedback.upsert(scope, vote);
    return vote;
  }

  /** Retira un voto (lápida). Idempotente: si no existe no hace nada. */
  async retract(scope: TenantScope, traceId: string, input: RetractFeedbackInput): Promise<void> {
    const spanId = input.spanId || null;
    const endUserId = input.endUserId?.trim() || null;
    const existing = (await this.feedback.listForTrace(scope, traceId)).find((v) => v.spanId === spanId && v.endUserId === endUserId);
    if (!existing) return;
    await this.feedback.retract(scope, { ...existing, createdAt: this.now().toISOString() });
  }

  /** Votos vigentes de la traza y si coinciden con la revisión humana. No exige que la traza siga existiendo. */
  async listForTrace(scope: TenantScope, traceId: string): Promise<TraceFeedback> {
    const votes = await this.feedback.listForTrace(scope, traceId);
    const alignment = (await this.alignments(scope, votes)).get(traceId) ?? "unknown";
    return { votes, alignment };
  }

  /** Votos de las trazas (o de las conversaciones, vía sus turnos) dadas, para las columnas de las listas. Solo los ids con algún voto. */
  async listRatings(scope: TenantScope, target: { traceIds: string[] } | { conversationIds: string[] }): Promise<FeedbackRatingSummary[]> {
    const byConversation = "conversationIds" in target ? await this.traces.getConversationTraceIds(scope, target.conversationIds, this.now().getTime()) : null;
    const groups = byConversation ? [...byConversation].map(([id, traceIds]) => ({ id, traceIds })) : (target as { traceIds: string[] }).traceIds.map((id) => ({ id, traceIds: [id] }));
    const traceIds = [...new Set(groups.flatMap((g) => g.traceIds))];
    if (traceIds.length === 0) return [];
    const votes = await this.feedback.listForTraces(scope, traceIds);
    const byTrace = new Map<string, UserFeedback[]>();
    for (const v of votes) byTrace.set(v.traceId, [...(byTrace.get(v.traceId) ?? []), v]);
    return groups.flatMap(({ id, traceIds: ids }) => {
      const own = ids.flatMap((t) => byTrace.get(t) ?? []);
      if (own.length === 0) return [];
      const up = own.filter((v) => v.rating === 1).length;
      return [{ id, up, down: own.length - up }];
    });
  }

  /** Totales, serie diaria, alineación y últimas trazas con 👎 del rango. */
  async overview(scope: TenantScope, range: TimeRange): Promise<FeedbackOverview> {
    const [summary, days, recent, down] = await Promise.all([
      this.feedback.summarize(scope, range.fromMs, range.toMs),
      this.feedback.daily(scope, range.fromMs, range.toMs),
      this.feedback.listRecent(scope, range.fromMs, range.toMs, ALIGNMENT_SCAN_LIMIT),
      this.feedback.listRecent(scope, range.fromMs, range.toMs, 200, -1),
    ]);
    const alignments = await this.alignments(scope, recent);
    let aligned = 0;
    let misaligned = 0;
    for (const a of alignments.values()) {
      if (a === "aligned") aligned += 1;
      else if (a === "misaligned") misaligned += 1;
    }
    const seen = new Set<string>();
    const recentDown = down
      .filter((v) => (seen.has(v.traceId) ? false : (seen.add(v.traceId), true)))
      .slice(0, RECENT_DOWN_ITEMS)
      .map((v) => ({ traceId: v.traceId, comment: v.comment, createdAt: v.createdAt }));
    return { summary, days, alignment: { aligned, misaligned }, recentDown };
  }

  /** Alineación por traza: el voto mayoritario frente al veredicto de las etiquetas humanas de la traza entera. */
  private async alignments(scope: TenantScope, votes: UserFeedback[]): Promise<Map<string, FeedbackAlignment>> {
    const traceIds = [...new Set(votes.map((v) => v.traceId))];
    const result = new Map<string, FeedbackAlignment>();
    if (traceIds.length === 0) return result;
    const [labels, configs] = await Promise.all([this.annotations.listForTraces(scope, traceIds), this.scoreConfigs.list(scope.experimentId, true)]);
    const configById = new Map<string, ScoreConfig>(configs.map((c) => [c.id, c]));
    const verdict = new Map<string, { good: number; bad: number }>();
    for (const a of labels) {
      if (a.dataType === "categorical") continue; // sin orden no hay bueno/malo (ADR-049)
      const v = verdict.get(a.traceId) ?? { good: 0, bad: 0 };
      if (isLowRating(a, configById.get(a.configId))) v.bad += 1;
      else v.good += 1;
      verdict.set(a.traceId, v);
    }
    for (const traceId of traceIds) {
      result.set(
        traceId,
        feedbackAlignment(
          votes.filter((v) => v.traceId === traceId),
          verdict.get(traceId) ?? { good: 0, bad: 0 },
        ),
      );
    }
    return result;
  }

  /**
   * Una traza de *otro* servicio se rechaza (responde como una inexistente). Una traza que aún no existe se acepta: el
   * usuario vota nada más ver la respuesta y el SDK exporta por lotes (unos segundos), así que el voto suele llegar
   * antes que los spans. No hay fuga entre tenants porque el voto se guarda y se lee siempre bajo el `ServiceName` de quien lo envía.
   */
  private async requireTraceInTenant(scope: TenantScope, traceId: string, spanId: string | null): Promise<void> {
    const found = await this.traces.getTraceSpans(scope, traceId, TRACE_LOOKUP_MAX_SPANS);
    if (!found) return;
    if (!found.spans.some((s) => s.serviceName === scope.serviceName)) throw new TraceNotFoundError(traceId);
    if (spanId && !found.truncated && !found.spans.some((s) => s.spanId === spanId)) throw new SpanNotFoundError(spanId);
  }
}

export type { FeedbackRating };
