import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getRetention } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Política de riesgo de la organización (ADR-102): el plazo de retención de cada nivel y el de cada agente (el de su nivel) con
 * quién lo clasificó. La lee quien gestiona la retención o ve la gobernanza.
 */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    const { authorizationService } = getIdentity();
    const allowed = (await authorizationService.canInOrganization(user.id, organizationId, "retention:manage")) || (await authorizationService.canInOrganization(user.id, organizationId, "governance:read"));
    if (!allowed) return problem(403, "Forbidden", "Missing permission: retention:manage or governance:read");
    return json(await getRetention().getPolicy(organizationId));
  });
}
