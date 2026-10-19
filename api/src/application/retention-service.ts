import type { AuditService } from "@/application/audit-service";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import type { TraceCounter } from "@/application/ports/trace-counter";
import type { TracePurger } from "@/application/ports/trace-purger";
import { RetentionConfirmationRequiredError, RetentionTargetNotFoundError } from "@/domain/errors";
import { retentionCutoff, retentionLevelOf, validateLevelRetention, type LevelChangePreview, type RetentionLevel, type RetentionPolicy } from "@/domain/retention";

export interface Actor {
  userId: string;
  email: string;
}

export interface PurgeSummary {
  experiments: number;
  spans: number;
  failed: number;
}

/**
 * Retención de trazas (ADR-084, ADR-102): lo que ve y cambia una persona con `retention:manage` (la ruta lo comprueba) y la pasada
 * diaria que borra lo vencido. Cada cambio y cada borrado queda en el registro de auditoría.
 */
export class RetentionService {
  constructor(
    private readonly repo: RetentionRepository,
    private readonly audit: AuditService,
    private readonly purger?: TracePurger,
    private readonly counter?: TraceCounter,
  ) {}

  async getPolicy(organizationId: string): Promise<RetentionPolicy> {
    const policy = await this.repo.getPolicy(organizationId);
    if (!policy) throw new RetentionTargetNotFoundError("Organization not found");
    return policy;
  }

  /** Qué pasaría al dejar un nivel en `days`: cuántos agentes y cuántos spans perderían datos. No cambia nada. */
  async previewLevelChange(organizationId: string, level: RetentionLevel, days: unknown): Promise<LevelChangePreview> {
    const value = validateLevelRetention(level, days);
    const policy = await this.getPolicy(organizationId);
    const previousDays = policy.levels.find((l) => l.level === level)!.days;
    const lowering = value < previousDays;
    const affected = lowering ? policy.agents.filter((a) => retentionLevelOf(a.level) === level) : [];
    let spans: number | null = lowering ? null : 0;
    if (lowering && this.counter && affected.length > 0) {
      try {
        const cutoff = retentionCutoff(new Date(), value);
        spans = 0;
        for (const a of affected) spans += await this.counter.countOlderThan({ experimentId: a.experimentId, serviceName: a.serviceName }, cutoff);
      } catch (error) {
        spans = null;
        console.error("[retention] could not count spans for the preview:", error);
      }
    } else if (lowering && affected.length === 0) {
      spans = 0;
    }
    return { level, previousDays, days: value, lowering, agents: affected.length, spans };
  }

  /**
   * Fija el plazo de un nivel. El suelo del AI Act lo impone el dominio. Bajarlo con agentes en ese nivel borra datos en la
   * próxima purga y no se deshace: pide `confirmLowering` (la pantalla enseña antes lo que se perdería).
   */
  async setLevelDays(organizationId: string, level: RetentionLevel, days: unknown, actor: Actor, confirmLowering = false): Promise<RetentionPolicy> {
    const preview = await this.previewLevelChange(organizationId, level, days);
    if (preview.lowering && preview.agents > 0 && !confirmLowering) throw new RetentionConfirmationRequiredError(preview);
    if (!(await this.repo.setLevelDays(organizationId, level, preview.days))) throw new RetentionTargetNotFoundError("Organization not found");
    await this.audit.record({
      organizationId,
      experimentId: null,
      actorUserId: actor.userId,
      actorLabel: actor.email,
      action: "retention.update",
      targetType: "risk_level",
      targetId: level,
      metadata: { level, days: preview.days, previousDays: preview.previousDays, agents: preview.agents },
    });
    return this.getPolicy(organizationId);
  }

  /**
   * Una pasada del worker: borra, por experimento, lo anterior a su plazo. Un fallo en un experimento no detiene a los demás.
   * Solo deja rastro cuando había algo que borrar, para no llenar el registro con una entrada por experimento y día.
   */
  async purgeExpired(now: Date = new Date()): Promise<PurgeSummary> {
    if (!this.purger) throw new Error("RetentionService needs a TracePurger to purge");
    const targets = await this.repo.listPurgeTargets();
    const summary: PurgeSummary = { experiments: targets.length, spans: 0, failed: 0 };
    for (const target of targets) {
      const cutoff = retentionCutoff(now, target.days);
      try {
        const { spans } = await this.purger.purge({ experimentId: target.experimentId, serviceName: target.serviceName }, cutoff);
        summary.spans += spans;
        if (spans > 0) {
          await this.audit.record({
            organizationId: target.organizationId,
            experimentId: target.experimentId,
            actorUserId: null,
            actorLabel: "system:retention",
            action: "retention.purge",
            targetType: "experiment",
            targetId: target.experimentId,
            metadata: { days: target.days, before: cutoff.toISOString(), spans },
          });
        }
      } catch (error) {
        summary.failed += 1;
        console.error(`[retention] purge failed for ${target.serviceName}:`, error);
      }
    }
    return summary;
  }
}
