import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAudit, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lista las API keys del experimento (sin el valor en claro, ADR-052). Con `apikey:manage_all` (org_admin) salen
 * todas; con `apikey:manage_own` (perfil técnico) solo las propias. Sin ninguno de los dos, 403.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireKeyAccess(experimentId);
  if (access instanceof Response) return access;
  const items = await getIdentity().identityRepository.listApiKeys(experimentId, access.all ? undefined : access.userId);
  return json({ items });
}

/** Genera una API key nueva para el experimento. El valor en claro solo se devuelve aquí, una vez. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await context.params;
  const access = await requireKeyAccess(experimentId);
  if (access instanceof Response) return access;
  const { identityRepository } = getIdentity();
  const { apiKey, plaintext } = await identityRepository.createApiKey(experimentId, access.userId);
  const experiment = await identityRepository.getExperiment(experimentId);
  // nunca el valor de la clave: solo su prefijo, que ya es público en la UI
  await getAudit().record({ action: "api_key.created", actorUserId: access.userId, actorEmail: access.email, organizationId: experiment?.organizationId ?? null, experimentId, targetType: "api_key", targetId: apiKey.id, detail: { keyPrefix: apiKey.keyPrefix } });
  return json({ ...apiKey, plaintext }, 201);
}

async function requireKeyAccess(experimentId: string): Promise<{ userId: string; email: string | null; all: boolean } | Response> {
  const own = await requirePermission(experimentId, "apikey:manage_own");
  if (!(own instanceof Response)) return { userId: own.user.id, email: own.user.email, all: own.permissions.includes("apikey:manage_all") };
  // sin manage_own: ¿tiene manage_all? (org_admin)
  const all = await requirePermission(experimentId, "apikey:manage_all");
  if (all instanceof Response) return problem(403, "Forbidden", "Missing permission: apikey:manage_own or apikey:manage_all");
  return { userId: all.user.id, email: all.user.email, all: true };
}
