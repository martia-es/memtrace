import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getExternalAccess } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Crea un token de portador para que el proveedor de identidad use SCIM. El valor en claro solo se devuelve aquí, una vez. */
export async function POST(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const { token, plaintext } = await getExternalAccess().externalRepository.createScimToken(organizationId, user.id);
    return json({ ...token, plaintext }, 201);
  });
}
