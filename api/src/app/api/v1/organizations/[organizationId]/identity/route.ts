import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { identityClaimBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getExternalAccess } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ organizationId: string }> };

/**
 * Identidad externa de la organización (ADR-052): cómo se llama la claim de grupos, qué grupo da qué rol y los
 * tokens SCIM (sin su valor en claro). Solo `org_admin`.
 */
export async function GET(request: Request, context: Params) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const { externalRepository } = getExternalAccess();
    const [groupsClaim, mappings, scimTokens] = await Promise.all([
      externalRepository.getGroupsClaim(organizationId),
      externalRepository.listMappings(organizationId),
      externalRepository.listScimTokens(organizationId),
    ]);
    return json({ groupsClaim, mappings, scimTokens, scimBaseUrl: `${new URL(request.url).origin}/api/scim/v2` });
  });
}

/** Cambia el nombre de la claim donde viene la lista de grupos en el token OIDC. */
export async function PATCH(request: Request, context: Params) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const { groupsClaim } = await parseJsonOrThrow(identityClaimBody, request);
    await getExternalAccess().externalRepository.setGroupsClaim(organizationId, groupsClaim);
    return json({ groupsClaim });
  });
}
