import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { levelRetentionBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getRetention } from "@/dependency-container";
import { isRetentionLevel } from "@/domain/retention";

export const dynamic = "force-dynamic";

/**
 * Fija el plazo de retención de un nivel (ADR-102). Requiere `retention:manage`. `high` y `unclassified` no bajan de 180 días (422);
 * bajarlo con agentes en ese nivel pide `confirmLowering` (409 con lo que se borraría). Queda en la auditoría.
 */
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; level: string }> }) {
  return identityGuard(async () => {
    const { organizationId, level } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "retention:manage"))) {
      return problem(403, "Forbidden", "Missing permission: retention:manage");
    }
    if (!isRetentionLevel(level)) return problem(404, "Not Found", "Unknown risk level");
    const body = await parseJsonOrThrow(levelRetentionBody, request);
    return json(await getRetention().setLevelDays(organizationId, level, body.days, { userId: user.id, email: user.email }, body.confirmLowering));
  });
}
