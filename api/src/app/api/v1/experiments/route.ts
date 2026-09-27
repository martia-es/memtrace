import { requireUser } from "@/adapters/inbound/http/auth-context";
import { json } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Experimentos visibles para el usuario: los suyos por membership directa + los de organizaciones donde es org_admin. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { identityRepository } = getIdentity();
  const items = await identityRepository.listExperimentsForUser(user.id);
  return json({ items });
}
