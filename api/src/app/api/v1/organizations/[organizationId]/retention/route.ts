import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { organizationRetentionBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getRetention } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Plazo de retención de trazas de la organización y el efectivo de cada experimento (ADR-084). Requiere `retention:manage`. */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "retention:manage"))) {
      return problem(403, "Forbidden", "Missing permission: retention:manage");
    }
    return json(await getRetention().getPolicy(organizationId));
  });
}

/** Cambia el plazo de la organización (1-365 días). Si lo acorta, los overrides más largos se quitan. Queda en la auditoría. */
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "retention:manage"))) {
      return problem(403, "Forbidden", "Missing permission: retention:manage");
    }
    const { days } = await parseJsonOrThrow(organizationRetentionBody, request);
    return json(await getRetention().setOrganizationDefault(organizationId, days, { userId: user.id, email: user.email }));
  });
}
