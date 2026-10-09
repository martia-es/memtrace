import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow, parseQueryOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRuleDto, toApprovalRulesResponse } from "@/adapters/inbound/http/prompt-mappers";
import { approvalRuleBody, approvalRuleQuery } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals, getIdentity } from "@/dependency-container";
import { PromptNotFoundError } from "@/domain/errors";

export const dynamic = "force-dynamic";

async function organizationOf(experimentId: string): Promise<string> {
  const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
  if (!experiment) throw new PromptNotFoundError("Experiment");
  return experiment.organizationId;
}

/**
 * Reglas de aprobación de este experimento (ADR-076), junto al suelo que pone su organización. Un experimento solo puede
 * endurecer lo que pide la organización. Requiere `approval:manage`.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    return json(toApprovalRulesResponse(await getApprovals().rulesWithOptions({ type: "experiment", id: experimentId }, await organizationOf(experimentId))));
  });
}

/** Crea o cambia la regla. 400 si pide menos que la de la organización para esa acción y entorno. */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(approvalRuleBody, request);
    return json(toApprovalRuleDto(await getApprovals().setRule({ type: "experiment", id: experimentId }, await organizationOf(experimentId), ctx.user.id, body)));
  });
}

/** Quita la regla del experimento; sigue valiendo la de la organización. `?action=&stage=`. */
export async function DELETE(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "approval:manage");
    if (ctx instanceof Response) return ctx;
    const query = parseQueryOrThrow(approvalRuleQuery, request);
    await getApprovals().deleteRule({ type: "experiment", id: experimentId }, query.action, query.stage);
    return json({ deleted: true });
  });
}
