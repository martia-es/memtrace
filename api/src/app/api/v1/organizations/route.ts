import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { createOrganizationBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista las organizaciones de las que soy org_admin. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { identityRepository } = getIdentity();
  const items = await identityRepository.listOrganizationsForUser(user.id);
  return json({ items });
}

/** Crea una organización nueva; el creador se convierte en su primer org_admin (ADR-013 bootstrap). */
export async function POST(request: Request) {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    const { name } = await parseJsonOrThrow(createOrganizationBody, request);
    const { identityRepository } = getIdentity();
    const organization = await identityRepository.createOrganization(name, user.id);
    return json(organization, 201);
  });
}
