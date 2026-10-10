import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { experimentRetentionBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getRetention } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Plazo propio de un experimento (ADR-084): más corto que el de su organización, o `null` para volver al de la organización.
 * Requiere `retention:manage` en la organización dueña.
 */
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; experimentId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "retention:manage"))) {
      return problem(403, "Forbidden", "Missing permission: retention:manage");
    }
    const { days } = await parseJsonOrThrow(experimentRetentionBody, request);
    return json(await getRetention().setExperimentOverride(organizationId, experimentId, days, { userId: user.id, email: user.email }));
  });
}
