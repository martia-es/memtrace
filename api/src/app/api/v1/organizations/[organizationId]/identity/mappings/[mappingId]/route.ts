import { requireOrgAdmin } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getExternalAccess } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Borra un mapeo: quien solo tenía ese rol por ese grupo lo pierde (SCIM al momento, OIDC en su próximo login). */
export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; mappingId: string }> }) {
  return identityGuard(async () => {
    const { organizationId, mappingId } = await context.params;
    const user = await requireOrgAdmin(organizationId);
    if (user instanceof Response) return user;
    const { externalRepository, externalAccessService } = getExternalAccess();
    if (!(await externalRepository.deleteMapping(organizationId, mappingId))) return problem(404, "Not Found", "Mapping not found");
    await externalAccessService.mappingsChanged(organizationId);
    return json({ deleted: true });
  });
}
