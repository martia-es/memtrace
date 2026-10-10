import { getAudit, getIdentity } from "@/dependency-container";
import type { AuditAction } from "@/domain/audit";
import type { User } from "@/domain/identity";

/**
 * Deja constancia (ADR-084) de una acción de una persona sobre un experimento. `view`: apertura de contenido, que nunca rompe la
 * petición; las demás (`strict`) fallan si no se puede registrar. Solo guarda identificadores, nunca el contenido.
 */
export async function auditExperiment(
  user: Pick<User, "id" | "email">,
  experimentId: string,
  action: AuditAction,
  target: { type: string; id: string },
  mode: "view" | "strict" | "best-effort" = "best-effort",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
  if (!experiment) return;
  const entry = {
    organizationId: experiment.organizationId,
    experimentId,
    actorUserId: user.id,
    actorLabel: user.email,
    action,
    targetType: target.type,
    targetId: target.id,
    metadata,
  };
  const audit = getAudit();
  if (mode === "view") await audit.recordView(entry);
  else if (mode === "strict") await audit.record(entry);
  else await audit.recordBestEffort(entry);
}

/** Igual que `auditExperiment`, para acciones que cuelgan de la organización (sin experimento). */
export async function auditOrganization(
  user: Pick<User, "id" | "email">,
  organizationId: string,
  action: AuditAction,
  target: { type: string; id: string },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await getAudit().recordBestEffort({ organizationId, experimentId: null, actorUserId: user.id, actorLabel: user.email, action, targetType: target.type, targetId: target.id, metadata });
}
