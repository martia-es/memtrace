import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { createPartnershipBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getPartnerships } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Consultoras (organizaciones partner) con acceso a esta organización y las personas concretas con su rol (ADR-080). Solo org_admin del cliente. */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    return json({ items: await getPartnerships().list(organizationId) });
  });
}

/**
 * Establece la relación con una consultora, identificada por el id de SU organización (que ella te facilita). Por sí sola no
 * da acceso a nada: después se concede, persona a persona, un rol (`.../grants`).
 */
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const { partnerOrganizationId } = await parseJsonOrThrow(createPartnershipBody, request);
    return json(await getPartnerships().create(organizationId, partnerOrganizationId, user), 201);
  });
}
