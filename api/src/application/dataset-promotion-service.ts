import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import type { Annotation } from "@/domain/annotation";
import { buildPromotedItem, extractTraceContent, resolveExpectedOutput, type PromotionSkipReason } from "@/domain/dataset-promotion";
import type { DatasetItem, DatasetVersion } from "@/domain/identity";

/** Techo de spans al leer una traza para promoverla: el mismo que usa el detalle de traza. */
const MAX_SPANS = 5000;

export interface PromotionActor {
  userId: string;
  /** Clave de tenant de ClickHouse: una traza de otro servicio se trata como inexistente. */
  serviceName: string;
}

export interface PromotionRequest {
  traceId: string;
  /** Entrada corregida por la persona (p. ej. tras tachar datos personales en el preview): sustituye a la extraída de la traza. */
  input?: unknown;
  expectedOutput?: unknown;
  fromConfigId?: string;
  /** Usa la respuesta del agente que se revisó como `expectedOutput` (ADR-061). Un `expectedOutput` explícito gana. */
  useObservedOutput?: boolean;
  /** Cola de revisión de la que sale la traza (ADR-050); solo procedencia, queda en `promotedFrom`. */
  queueId?: string;
}

export interface PromotionResult {
  added: DatasetItem[];
  skipped: Array<{ traceId: string; reason: PromotionSkipReason }>;
  version: DatasetVersion | null;
}

/**
 * Promoción de trazas a items de dataset (ADR-038). No añade mecánica de datasets nueva: construye los items
 * y delega en `IdentityRepository.addPromotedDatasetItems`, que crea UNA versión MAJOR por llamada.
 * La autorización de rol y la pertenencia del dataset al experimento las comprueba la ruta.
 */
export class DatasetPromotionService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly traces: TraceRepository,
    private readonly annotations: AnnotationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async promoteTraces(actor: PromotionActor, datasetId: string, requests: PromotionRequest[]): Promise<PromotionResult> {
    const skipped: PromotionResult["skipped"] = [];
    const unique: PromotionRequest[] = [];
    const seen = new Set<string>();
    for (const request of requests) {
      if (seen.has(request.traceId)) skipped.push({ traceId: request.traceId, reason: "already_promoted" });
      else unique.push(request);
      seen.add(request.traceId);
    }

    const traceIds = unique.map((r) => r.traceId);
    const [spansByTrace, annotations] = await Promise.all([
      this.traces.getTraceSpansForTraces(traceIds, MAX_SPANS),
      this.annotations.listForTraces(actor.serviceName, traceIds),
    ]);
    const annotationsByTrace = new Map<string, Annotation[]>();
    for (const a of annotations) annotationsByTrace.set(a.traceId, [...(annotationsByTrace.get(a.traceId) ?? []), a]);

    const drafts: ReturnType<typeof buildPromotedItem>[] = [];
    for (const request of unique) {
      const found = spansByTrace.get(request.traceId);
      const own = found?.spans.filter((s) => s.serviceName === actor.serviceName) ?? [];
      if (own.length === 0) {
        skipped.push({ traceId: request.traceId, reason: "not_found" });
        continue;
      }
      const extracted = extractTraceContent(own);
      const content = request.input !== undefined ? { input: request.input, output: extracted?.output ?? null } : extracted;
      if (!content) {
        skipped.push({ traceId: request.traceId, reason: "no_content" });
        continue;
      }
      const traceAnnotations = annotationsByTrace.get(request.traceId) ?? [];
      const expected = resolveExpectedOutput({ expectedOutput: request.expectedOutput, useObservedOutput: request.useObservedOutput, observedOutput: content.output, fromConfigId: request.fromConfigId, annotations: traceAnnotations });
      if (!expected.ok) {
        skipped.push({ traceId: request.traceId, reason: expected.reason });
        continue;
      }
      drafts.push(buildPromotedItem({ traceId: request.traceId, content, expectedOutput: expected.value, annotations: traceAnnotations, promotedBy: actor.userId, promotedAt: this.now(), queueId: request.queueId }));
    }

    if (drafts.length === 0) return { added: [], skipped, version: null };
    const result = await this.identity.addPromotedDatasetItems(datasetId, actor.userId, drafts);
    for (const traceId of result.alreadyPromoted) skipped.push({ traceId, reason: "already_promoted" });
    return { added: result.added, skipped, version: result.version };
  }
}
