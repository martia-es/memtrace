import type { AuditService } from "@/application/audit-service";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import type { TracePurger } from "@/application/ports/trace-purger";
import { RetentionTargetNotFoundError, ValidationError } from "@/domain/errors";
import { retentionCutoff, validateRetentionDays, type RetentionPolicy } from "@/domain/retention";

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
 * Retención de trazas (ADR-084): lo que ve y cambia una persona con `retention:manage` (la ruta lo comprueba) y la pasada
 * diaria que borra lo vencido. Cada cambio y cada borrado queda en el registro de auditoría.
 */
export class RetentionService {
  constructor(
    private readonly repo: RetentionRepository,
    private readonly audit: AuditService,
    private readonly purger?: TracePurger,
  ) {}

  async getPolicy(organizationId: string): Promise<RetentionPolicy> {
    const policy = await this.repo.getPolicy(organizationId);
    if (!policy) throw new RetentionTargetNotFoundError("Organization not found");
    return policy;
  }

  /** Cambia el plazo de la organización. Si acorta, los overrides más largos que el nuevo plazo se quitan. */
  async setOrganizationDefault(organizationId: string, days: unknown, actor: Actor): Promise<RetentionPolicy> {
    const value = validateRetentionDays(days);
    const result = await this.repo.setOrganizationDefault(organizationId, value);
    if (!result) throw new RetentionTargetNotFoundError("Organization not found");
    await this.audit.record({
      organizationId,
      experimentId: null,
      actorUserId: actor.userId,
      actorLabel: actor.email,
      action: "retention.update",
      targetType: "organization",
      targetId: organizationId,
      metadata: { days: value, clearedOverrides: result.clearedExperimentIds.length },
    });
    return this.getPolicy(organizationId);
  }

  /** Pone o quita (null) el plazo propio de un experimento. No puede ser más largo que el de la organización. */
  async setExperimentOverride(organizationId: string, experimentId: string, days: unknown, actor: Actor): Promise<RetentionPolicy> {
    const policy = await this.getPolicy(organizationId);
    const value = days === null ? null : validateRetentionDays(days);
    if (value !== null && value > policy.defaultDays) {
      throw new ValidationError("Invalid retention", { days: `An experiment can keep traces for less time than its organization (${policy.defaultDays} days), not more` });
    }
    if (!(await this.repo.setExperimentOverride(organizationId, experimentId, value))) throw new RetentionTargetNotFoundError("Experiment not found in this organization");
    await this.audit.record({
      organizationId,
      experimentId,
      actorUserId: actor.userId,
      actorLabel: actor.email,
      action: "retention.update",
      targetType: "experiment",
      targetId: experimentId,
      metadata: { days: value },
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
        const { spans } = await this.purger.purge(target.serviceName, cutoff);
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
