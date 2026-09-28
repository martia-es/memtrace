import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { organizationThemeBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Reemplaza el tema visual (accent color + radius preset) de la organización (ADR-019). Requiere ser org_admin. */
export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { identityRepository, authorizationService } = getIdentity();
    if (!(await authorizationService.canManageOrganization(user.id, organizationId))) {
      return problem(403, "Forbidden", "No permission to manage this organization's theme");
    }

    const theme = await parseJsonOrThrow(organizationThemeBody, request);
    const organization = await identityRepository.updateOrganizationTheme(organizationId, theme);
    return json(organization);
  });
}
