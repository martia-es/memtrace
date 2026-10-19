import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getRetention } from "@/dependency-container";
import { isRetentionLevel } from "@/domain/retention";

export const dynamic = "force-dynamic";

/** Qué pasaría al dejar un nivel en `?days=N`: agentes y spans que perderían datos. No cambia nada. Requiere `retention:manage`. */
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; level: string }> }) {
  return identityGuard(async () => {
    const { organizationId, level } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    if (!(await getIdentity().authorizationService.canInOrganization(user.id, organizationId, "retention:manage"))) {
      return problem(403, "Forbidden", "Missing permission: retention:manage");
    }
    if (!isRetentionLevel(level)) return problem(404, "Not Found", "Unknown risk level");
    const days = Number(new URL(request.url).searchParams.get("days"));
    return json(await getRetention().previewLevelChange(organizationId, level, days));
  });
}
