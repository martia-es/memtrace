import { requireOrganizationPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Histórico de solicitudes de aprobación de la organización (ADR-076), de cualquier estado, las más recientes primero. Requiere `approval:manage`. */
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireOrganizationPermission(organizationId, "approval:manage");
    if (user instanceof Response) return user;
    return json({ items: (await getApprovals().history(organizationId)).map(toApprovalRequestDto) });
  });
}
