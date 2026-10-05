import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getExternalAccess } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Revoca un token SCIM: el proveedor de identidad deja de poder sincronizar con él. */
export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; tokenId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, tokenId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    if (!(await getExternalAccess().externalRepository.revokeScimToken(organizationId, tokenId))) return problem(404, "Not Found", "Token not found");
    return json({ revoked: true });
  });
}
