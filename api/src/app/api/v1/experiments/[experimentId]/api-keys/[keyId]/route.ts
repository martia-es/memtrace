import { auditExperiment } from "@/adapters/inbound/http/audit-context";
import { requirePermission, requireUser } from "@/adapters/inbound/http/auth-context";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Revoca una API key: cualquiera con `apikey:manage_all`, o la propia con `apikey:manage_own` (ADR-052). */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; keyId: string }> }) {
  const { experimentId, keyId } = await context.params;
  const own = await requirePermission(experimentId, "apikey:manage_own");
  let onlyCreatedBy: string | undefined;
  if (!(own instanceof Response)) {
    onlyCreatedBy = own.permissions.includes("apikey:manage_all") ? undefined : own.user.id;
  } else {
    const all = await requirePermission(experimentId, "apikey:manage_all");
    if (all instanceof Response) return problem(403, "Forbidden", "Missing permission: apikey:manage_own or apikey:manage_all");
  }
  await getIdentity().identityRepository.revokeApiKey(experimentId, keyId, onlyCreatedBy);
  const actor = await requireUser();
  if (!(actor instanceof Response)) await auditExperiment(actor, experimentId, "apikey.revoke", { type: "api_key", id: keyId });
  return json({ revoked: true });
}
