import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAudit, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Revoca una API key: cualquiera con `apikey:manage_all`, o la propia con `apikey:manage_own` (ADR-052). */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; keyId: string }> }) {
  const { experimentId, keyId } = await context.params;
  const own = await requirePermission(experimentId, "apikey:manage_own");
  let onlyCreatedBy: string | undefined;
  let actor: { id: string; email: string | null };
  if (!(own instanceof Response)) {
    onlyCreatedBy = own.permissions.includes("apikey:manage_all") ? undefined : own.user.id;
    actor = own.user;
  } else {
    const all = await requirePermission(experimentId, "apikey:manage_all");
    if (all instanceof Response) return problem(403, "Forbidden", "Missing permission: apikey:manage_own or apikey:manage_all");
    actor = all.user;
  }
  const { identityRepository } = getIdentity();
  await identityRepository.revokeApiKey(experimentId, keyId, onlyCreatedBy);
  const experiment = await identityRepository.getExperiment(experimentId);
  await getAudit().record({ action: "api_key.revoked", actorUserId: actor.id, actorEmail: actor.email, organizationId: experiment?.organizationId ?? null, experimentId, targetType: "api_key", targetId: keyId });
  return json({ revoked: true });
}
