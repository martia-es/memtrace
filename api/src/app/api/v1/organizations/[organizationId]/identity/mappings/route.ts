import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { mappingBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getExternalAccess } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Que un grupo del proveedor de identidad dé un rol: en toda la organización (`experimentId: null`, rol de
 * organización) o en un experimento. Los usuarios SCIM se recalculan al momento; los de OIDC, en su próximo login.
 */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const body = await parseJsonOrThrow(mappingBody, request);
    const { externalRepository, externalAccessService } = getExternalAccess();
    const mapping = await externalRepository.createMapping(organizationId, body);
    await externalAccessService.mappingsChanged(organizationId);
    return json(mapping, 201);
  });
}
