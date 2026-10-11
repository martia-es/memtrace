import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getIdentity, getModelQuality } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Modelos en uso que esperan una decisión de calidad (ADR-025), para la pestaña «Models» de la campana. Solo cuenta los agentes
 * donde la persona tiene `pricing:manage`: quien no puede decidir no recibe el aviso. Es estado vivo, no un evento (ADR-094).
 */
export async function GET() {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    const experiments = await getIdentity().identityRepository.listExperimentsForUser(user.id);
    const managed = experiments
      .filter((e) => e.permissions.includes("pricing:manage"))
      .map((e) => ({ experimentId: e.id, organizationId: e.organizationId, scope: { experimentId: e.id, serviceName: e.serviceName } }));
    return json(await getModelQuality().pending(managed));
  });
}
