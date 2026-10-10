import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow, partnerGrantBody } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getPartnerships } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Da a una persona de la consultora (por email, y solo si es miembro de la organización partner) un rol de experimento en
 * toda esta organización o en un experimento. Repetir la misma persona y alcance cambia el rol.
 */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; partnershipId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, partnershipId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const body = await parseJsonOrThrow(partnerGrantBody, request);
    return json(await getPartnerships().grant(organizationId, partnershipId, body, user), 201);
  });
}
