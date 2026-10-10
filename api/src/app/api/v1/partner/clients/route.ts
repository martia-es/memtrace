import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getPartnerships } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Los clientes que han dado acceso a la persona que llama (ADR-091), con los experimentos y el rol concedidos. Solo
 * metadatos: los datos de un cliente se abren por sus rutas de experimento, que exigen el grant.
 */
export async function GET() {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    return json({ items: await getPartnerships().clientsOf(user.id) });
  });
}
