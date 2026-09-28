import { requireUser } from "@/adapters/inbound/http/auth-context";
import { getHandlers, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Tokens por experimento accesible al usuario (mismo criterio que `GET /experiments`): comparativa de coste entre agentes. */
export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { identityRepository } = getIdentity();
  const experiments = await identityRepository.listExperimentsForUser(user.id);
  return getHandlers().usageByExperiments(request, experiments);
}
