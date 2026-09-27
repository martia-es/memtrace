import { requireUser } from "@/adapters/inbound/http/auth-context";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Revoca una API key. Requiere admin/org_admin del experimento. */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; keyId: string }> }) {
  const { experimentId, keyId } = await context.params;
  const user = await requireUser();
  if (user instanceof Response) return user;

  const { authorizationService, identityRepository } = getIdentity();
  if (!(await authorizationService.canManageExperimentMembers(user.id, experimentId))) {
    return problem(403, "Forbidden", "No permission to manage API keys of this experiment");
  }
  await identityRepository.revokeApiKey(experimentId, keyId);
  return json({ revoked: true });
}
