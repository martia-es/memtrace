import { requireUser } from "@/adapters/inbound/http/auth-context";
import { getHandlers, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Servicios con datos, solo de los experimentos que la persona puede leer (ADR-088). Antes no exigía sesión y listaba los de todos. */
export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const experiments = await getIdentity().identityRepository.listExperimentsForUser(user.id);
  return getHandlers().services(request, experiments.map((e) => ({ experimentId: e.id, serviceName: e.serviceName })));
}
