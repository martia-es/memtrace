import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { getPartnerships } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Corta la relación: todos los grants de esa consultora dejan de valer en la siguiente petición. */
export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; partnershipId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, partnershipId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    await getPartnerships().revoke(organizationId, partnershipId, user.id);
    return new Response(null, { status: 204 });
  });
}
