import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lo que esta persona tiene pendiente de aprobar en la organización (ADR-076): solicitudes vivas donde puede decidir y aún
 * no ha respondido; `?experimentId=` lo limita a los prompts de ese agente. Solo devuelve lo que ella puede decidir, así que basta con tener sesión.
 */
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return identityGuard(async () => {
    const { organizationId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;
    const experimentId = new URL(request.url).searchParams.get("experimentId") ?? undefined;
    const items = await getApprovals().inbox(organizationId, user.id, experimentId);
    return json({ items: items.map(toApprovalRequestDto) });
  });
}
