import { tenantOf, type TenantScope } from "@/domain/tenant";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import { isLowRating, validateAnnotationValue, type Annotation, type AnnotationValue, type AnnotationRating, type LowRatedSummary, type TraceScore } from "@/domain/annotation";
import type { TimeRange } from "@/domain/time-range";
import { AnnotationForbiddenError, ScoreConfigInvariantError, ScoreConfigNotFoundError, SpanNotFoundError, TraceNotFoundError } from "@/domain/errors";
import {
  applyScoreConfigPatch,
  validateNewScoreConfig,
  type NewScoreConfig,
  type ScoreConfig,
  type ScoreConfigPatch,
} from "@/domain/score-config";

/** Techo de spans al comprobar que una traza (y un span) existen: el mismo que usa el detalle de traza. */
const TRACE_LOOKUP_MAX_SPANS = 5000;

/** Etiquetas recientes que se revisan para buscar valoraciones bajas, y cuántas trazas se devuelven con detalle. */
const LOW_RATED_SCAN_LIMIT = 2000;
const LOW_RATED_ITEMS = 10;

/** Quién anota y en qué tenant: `serviceName` es la clave de tenant de ClickHouse, `experimentId` la de PostgreSQL. */
export interface AnnotationActor {
  userId: string;
  experimentId: string;
  serviceName: string;
}

export interface SaveAnnotationInput {
  configId: string;
  value: AnnotationValue;
  comment?: string | null;
  spanId?: string | null;
}

export interface RetractAnnotationInput {
  configId: string;
  spanId?: string | null;
  /** Retirar la de otra persona (moderación): exige `actorIsAdmin`. Por defecto, la propia. */
  annotatorId?: string;
  actorIsAdmin: boolean;
}

export interface AnnotationWithAuthor extends Annotation {
  /** null si el usuario ya no existe o no tiene nombre: la UI lo muestra como "former member". No se expone el email. */
  annotatorName: string | null;
}

export interface TraceJudgments {
  annotations: AnnotationWithAuthor[];
  scores: TraceScore[];
}

/**
 * Casos de uso de anotación humana: score configs (ADR-036) y anotaciones sobre trazas (ADR-037), en vez
 * de seguir creciendo `EvaluationService`. La autorización de rol la decide el llamador (ver
 * `AuthorizationService`); aquí se comprueba lo que depende de los datos: pertenencia al tenant,
 * configs vivas y valores válidos.
 */
export class AnnotationService {
  constructor(
    private readonly scoreConfigs: ScoreConfigRepository,
    private readonly annotations: AnnotationRepository,
    private readonly traces: TraceRepository,
    private readonly scores: ScoreRepository,
    private readonly identity: Pick<IdentityRepository, "getUsersByIds">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Crea o edita la anotación del usuario para (traza, span, config). El anotador siempre es quien llama. */
  async saveAnnotation(actor: AnnotationActor, traceId: string, input: SaveAnnotationInput): Promise<Annotation> {
    const config = await this.requireConfig(actor.experimentId, input.configId);
    if (config.archivedAt) throw new ScoreConfigInvariantError("Archived score configs cannot receive new annotations");
    const value = validateAnnotationValue(config, input.value);
    await this.requireTraceInTenant(tenantOf(actor), traceId, input.spanId ?? null);

    const annotation: Annotation = {
      traceId,
      spanId: input.spanId || null,
      configId: config.id,
      configName: config.name,
      dataType: config.dataType,
      annotatorId: actor.userId,
      value,
      comment: input.comment?.trim() || null,
      createdAt: this.now().toISOString(),
    };
    await this.annotations.upsert(tenantOf(actor), annotation);
    return annotation;
  }

  /** Anotaciones humanas vigentes de la traza + scores automáticos de la misma traza. No exige que la traza siga existiendo. */
  async listForTrace(scope: TenantScope, traceId: string): Promise<TraceJudgments> {
    const [annotations, scores] = await Promise.all([this.annotations.listForTrace(scope, traceId), this.scores.listScoresByTrace(scope, traceId)]);
    const users = await this.identity.getUsersByIds([...new Set(annotations.map((a) => a.annotatorId))]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { annotations: annotations.map((a) => ({ ...a, annotatorName: names.get(a.annotatorId) ?? null })), scores };
  }

  /** Trazas con alguna valoración humana baja en el rango (ADR-049). Cuenta trazas distintas, no etiquetas. */
  async listLowRated(scope: TenantScope, range: TimeRange): Promise<LowRatedSummary> {
    const [labels, configs] = await Promise.all([
      this.annotations.listRecentForTraces(scope, range.fromMs, range.toMs, LOW_RATED_SCAN_LIMIT),
      this.scoreConfigs.list(scope.experimentId, true),
    ]);
    const byId = new Map(configs.map((c) => [c.id, c]));
    const low = labels.filter((a) => isLowRating(a, byId.get(a.configId)));
    const firstPerTrace = new Map<string, Annotation>();
    for (const a of low) if (!firstPerTrace.has(a.traceId)) firstPerTrace.set(a.traceId, a);
    return {
      count: firstPerTrace.size,
      items: [...firstPerTrace.values()].slice(0, LOW_RATED_ITEMS).map((a) => ({ traceId: a.traceId, configName: a.configName, value: a.value, createdAt: a.createdAt })),
    };
  }

  /**
   * Etiquetas humanas de las trazas (o de las conversaciones, vía sus turnos) dadas, para la columna Annotation de las
   * listas. Solo aparecen los ids con alguna etiqueta; `low` usa el mismo criterio que `listLowRated`.
   */
  async listRatings(scope: TenantScope, target: { traceIds: string[] } | { conversationIds: string[] }): Promise<AnnotationRating[]> {
    const byConversation = "conversationIds" in target ? await this.traces.getConversationTraceIds(scope, target.conversationIds, this.now().getTime()) : null;
    const groups = byConversation ? [...byConversation].map(([id, traceIds]) => ({ id, traceIds })) : (target as { traceIds: string[] }).traceIds.map((id) => ({ id, traceIds: [id] }));
    const traceIds = [...new Set(groups.flatMap((g) => g.traceIds))];
    if (traceIds.length === 0) return [];
    const [labels, configs] = await Promise.all([this.annotations.listForTraces(scope, traceIds), this.scoreConfigs.list(scope.experimentId, true)]);
    const byId = new Map(configs.map((c) => [c.id, c]));
    const labelsByTrace = new Map<string, Annotation[]>();
    for (const a of labels) labelsByTrace.set(a.traceId, [...(labelsByTrace.get(a.traceId) ?? []), a]);
    return groups.flatMap(({ id, traceIds: ids }) => {
      const own = ids.flatMap((t) => labelsByTrace.get(t) ?? []);
      return own.length ? [{ id, labels: own.length, low: own.some((a) => isLowRating(a, byId.get(a.configId))) }] : [];
    });
  }

  /** Retira una anotación (lápida). Idempotente: si no existe no hace nada. */
  async retractAnnotation(actor: AnnotationActor, traceId: string, input: RetractAnnotationInput): Promise<void> {
    const target = input.annotatorId ?? actor.userId;
    if (target !== actor.userId && !input.actorIsAdmin) throw new AnnotationForbiddenError();
    await this.requireConfig(actor.experimentId, input.configId);

    const spanId = input.spanId || null;
    const existing = (await this.annotations.listForTrace(tenantOf(actor), traceId)).find(
      (a) => a.configId === input.configId && a.spanId === spanId && a.annotatorId === target,
    );
    if (!existing) return;
    await this.annotations.retract(tenantOf(actor), {
      ...existing,
      value: "",
      // la lápida es el único rastro de una retirada por moderación (el valor anterior desaparece al fusionar)
      comment: target === actor.userId ? null : `Retracted by admin ${actor.userId}`,
      createdAt: this.now().toISOString(),
    });
  }

  /**
   * La traza debe existir *bajo el servicio del experimento*: sin esto alguien podría escribir
   * anotaciones apuntando al `TraceId` de otro tenant. Una traza ajena responde igual que una inexistente.
   */
  private async requireTraceInTenant(scope: TenantScope, traceId: string, spanId: string | null): Promise<void> {
    const found = await this.traces.getTraceSpans(scope, traceId, TRACE_LOOKUP_MAX_SPANS);
    if (!found || !found.spans.some((s) => s.serviceName === scope.serviceName)) throw new TraceNotFoundError(traceId);
    // con la traza truncada puede que el span exista pero no se haya cargado: no se rechaza
    if (spanId && !found.truncated && !found.spans.some((s) => s.spanId === spanId)) throw new SpanNotFoundError(spanId);
  }

  listScoreConfigs(experimentId: string, includeArchived = false): Promise<ScoreConfig[]> {
    return this.scoreConfigs.list(experimentId, includeArchived);
  }

  async createScoreConfig(experimentId: string, userId: string, input: NewScoreConfig): Promise<ScoreConfig> {
    return this.scoreConfigs.create(experimentId, userId, validateNewScoreConfig(input));
  }

  async updateScoreConfig(experimentId: string, configId: string, patch: ScoreConfigPatch): Promise<ScoreConfig> {
    const current = await this.requireConfig(experimentId, configId);
    const updated = await this.scoreConfigs.update(experimentId, configId, applyScoreConfigPatch(current, patch));
    if (!updated) throw new ScoreConfigNotFoundError(configId);
    return updated;
  }

  async archiveScoreConfig(experimentId: string, configId: string): Promise<ScoreConfig> {
    return this.setArchived(experimentId, configId, true);
  }

  async unarchiveScoreConfig(experimentId: string, configId: string): Promise<ScoreConfig> {
    return this.setArchived(experimentId, configId, false);
  }

  private async setArchived(experimentId: string, configId: string, archived: boolean): Promise<ScoreConfig> {
    const updated = await this.scoreConfigs.setArchived(experimentId, configId, archived);
    if (!updated) throw new ScoreConfigNotFoundError(configId);
    return updated;
  }

  private async requireConfig(experimentId: string, configId: string): Promise<ScoreConfig> {
    const config = await this.scoreConfigs.get(experimentId, configId);
    if (!config) throw new ScoreConfigNotFoundError(configId);
    return config;
  }
}
