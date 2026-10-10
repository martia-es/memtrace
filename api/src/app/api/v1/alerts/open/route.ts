import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAlerts, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Alertas disparadas ahora en los agentes que la persona puede leer (ADR-086), para la campana de la barra superior. Solo cuenta los
 * experimentos con `experiment:read`: una alerta no se enseña a quien no puede ver el agente.
 */
export async function GET() {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    const experiments = await getIdentity().identityRepository.listExperimentsForUser(user.id);
    const readable = experiments.filter((e) => e.permissions.includes("experiment:read")).map((e) => e.id);
    return json({ items: await getAlerts().listOpen(readable) });
  });
}
