import type { AnnotationService } from "@/application/annotation-service";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import type { TenantScope } from "@/domain/tenant";
import { isLowScore, reasonsOf, type FailureReason, type PromptFailure } from "@/domain/prompt-failure";
import { resolveTimeRange } from "@/domain/time-range";

/** Cuántas de las trazas más recientes del prompt se miran; más allá, la lista dejaría de ser «lo reciente». */
const SCAN_LIMIT = 300;
const MAX_FAILURES = 100;

export interface PromptFailures {
  items: PromptFailure[];
  /** cuántas trazas del prompt se han examinado (las más recientes del rango) */
  scanned: number;
  /** cuántos fallos hay por motivo, entre los examinados (una traza con varios motivos cuenta en cada uno) */
  counts: Record<FailureReason, number>;
}

/**
 * Los fallos recientes de un prompt (ADR-077): de sus últimas trazas, las que tienen algún motivo para arreglarse.
 * Cruza cuatro almacenes por id de traza en lote (errores, scores automáticos, etiquetas humanas, 👎), en vez de
 * pedirle a la persona que busque un id en otra pantalla. La ruta ya comprobó permisos y que el prompt es del agente.
 */
export class PromptFailureService {
  constructor(
    private readonly traces: TraceRepository,
    private readonly scores: ScoreRepository,
    private readonly feedback: UserFeedbackRepository,
    private readonly annotations: AnnotationService,
    private readonly now: () => number = Date.now,
  ) {}

  async list(scope: TenantScope, promptName: string, input: { from?: Date; to?: Date }): Promise<PromptFailures> {
    const range = resolveTimeRange(input, this.now());
    const page = await this.traces.listTraces({ ...range, scope, promptName, limit: SCAN_LIMIT });
    const ids = page.items.map((t) => t.traceId);
    const [scores, votes, ratings] = await Promise.all([
      this.scores.listScoresByTraces(scope, ids),
      this.feedback.listForTraces(scope, ids),
      this.annotations.listRatings(scope, { traceIds: ids }),
    ]);
    const lowScore = new Set(scores.filter(isLowScore).map((s) => s.traceId));
    const disliked = new Set(votes.filter((v) => v.rating === -1).map((v) => v.traceId));
    const humanLow = new Set(ratings.filter((r) => r.low).map((r) => r.id));

    const counts: Record<FailureReason, number> = { error: 0, low_score: 0, human_low: 0, user_dislike: 0 };
    const items: PromptFailure[] = [];
    for (const t of page.items) {
      const reasons = reasonsOf({ error: t.errorCount > 0 || t.status === "error", low_score: lowScore.has(t.traceId), human_low: humanLow.has(t.traceId), user_dislike: disliked.has(t.traceId) });
      if (reasons.length === 0) continue;
      for (const r of reasons) counts[r] += 1;
      if (items.length < MAX_FAILURES) items.push({ traceId: t.traceId, startTimeUs: t.startTimeUs, input: t.input, output: t.output, error: t.error, prompts: t.prompts, reasons });
    }
    return { items, scanned: ids.length, counts };
  }
}
