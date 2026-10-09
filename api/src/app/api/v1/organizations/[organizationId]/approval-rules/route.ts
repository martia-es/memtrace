import { requireOrganizationPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow, parseQueryOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRuleDto, toApprovalRulesResponse } from "@/adapters/inbound/http/prompt-mappers";
import { approvalRuleBody, approvalRuleQuery } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Reglas de aprobación de la organización (ADR-076): el suelo para todos sus experimentos. Un experimento puede endurecerlas,
 * nunca aflojarlas. Con las opciones para escribirlas (perfiles, entornos, personas). Requiere `approval:manage`.
 */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "approval:manage");
    if (user instanceof Response) return user;
    return json(toApprovalRulesResponse(await getApprovals().rulesWithOptions({ type: "organization", id: organizationId }, organizationId)));
  });
}

/** Crea o cambia la regla de una acción (y entorno, en `promote`). Sin perfiles ni aprobadores no es una regla: se borra. */
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "approval:manage");
    if (user instanceof Response) return user;
    const body = await parseJsonOrThrow(approvalRuleBody, request);
    return json(toApprovalRuleDto(await getApprovals().setRule({ type: "organization", id: organizationId }, organizationId, user.id, body)));
  });
}

/** Quita la regla: esa acción vuelve a hacerse sin aprobación (salvo que un experimento tenga la suya). `?action=&stage=`. */
export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "approval:manage");
    if (user instanceof Response) return user;
    const query = parseQueryOrThrow(approvalRuleQuery, request);
    await getApprovals().deleteRule({ type: "organization", id: organizationId }, query.action, query.stage);
    return json({ deleted: true });
  });
}
