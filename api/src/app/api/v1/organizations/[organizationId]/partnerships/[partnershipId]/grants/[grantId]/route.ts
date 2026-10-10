import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { getPartnerships } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Quita el acceso de una persona de la consultora. Efecto inmediato. */
export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; partnershipId: string; grantId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, partnershipId, grantId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    await getPartnerships().revokeGrant(organizationId, partnershipId, grantId, user);
    return new Response(null, { status: 204 });
  });
}
