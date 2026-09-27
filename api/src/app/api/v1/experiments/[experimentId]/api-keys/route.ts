import { requireUser } from "@/adapters/inbound/http/auth-context";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lista las API keys del experimento (sin el valor en claro). Requiere solo acceso de lectura al
 * experimento (ADR-016): un `member` necesita poder ver/generar su propia key para instrumentar el
 * agente, aunque no pueda invitar a nadie más.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { authorizationService, identityRepository } = getIdentity();
  if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
    return problem(403, "Forbidden", "No access to this experiment");
  }
  const items = await identityRepository.listApiKeys(experimentId);
  return json({ items });
}

/** Genera una API key nueva para el experimento. El valor en claro solo se devuelve aquí, una vez. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { authorizationService, identityRepository } = getIdentity();
  if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
    return problem(403, "Forbidden", "No access to this experiment");
  }
  const { apiKey, plaintext } = await identityRepository.createApiKey(experimentId, user.id);
  return json({ ...apiKey, plaintext }, 201);
}
