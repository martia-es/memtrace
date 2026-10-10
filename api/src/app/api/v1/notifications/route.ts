import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAlerts, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Avisos recientes de la campana (ADR-094): alertas disparadas o resueltas y avisos de presupuesto de los agentes que la persona puede
 * leer, con cuáles no ha leído. Como la campana de alertas abiertas, solo cuenta los experimentos con `experiment:read`.
 */
export async function GET() {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    const experiments = await getIdentity().identityRepository.listExperimentsForUser(user.id);
    const readable = experiments.filter((e) => e.permissions.includes("experiment:read")).map((e) => e.id);
    return json(await getAlerts().notifications(user.id, readable));
  });
}
