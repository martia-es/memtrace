import { auditExperiment } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow, parseQueryOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { approvalRuleQuery } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

const target = (action: string, stage: string) => ({ type: "approval_step", id: action === "publish" ? "publish" : `promote:${stage}` });

/**
 * Exime a este experimento de la regla de aprobación de su organización en un paso (ADR-076, excepciones). Requiere
 * `approval:manage`, que solo tiene el `org_admin`: quien administra un experimento no puede eximirse a sí mismo. Queda en la auditoría.
 */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(approvalRuleQuery, request);
    const step = await getApprovals().setExemption(experimentId, ctx.organizationId, ctx.user.id, body);
    await auditExperiment(ctx.user, experimentId, "approval_exemption.grant", target(step.action, step.stage), "strict", { action: step.action, stage: step.stage });
    return json(step);
  });
}

/** Vuelve a aplicar la regla de la organización a este experimento en ese paso. `?action=&stage=`. */
export async function DELETE(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    const query = parseQueryOrThrow(approvalRuleQuery, request);
    await getApprovals().deleteExemption(experimentId, query.action, query.stage);
    await auditExperiment(ctx.user, experimentId, "approval_exemption.revoke", target(query.action, query.stage), "strict", { action: query.action, stage: query.stage });
    return json({ deleted: true });
  });
}
