import { requireApprovalAccess } from "@/adapters/inbound/http/approval-access";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { approvalDecisionBody } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Aprueba o rechaza una solicitud (ADR-076). 403 si es quien la pidió o su perfil no es de los que la regla pide. Al reunirse
 * todo, la acción se ejecuta sola; si el gate de evaluación la frena queda aprobada con el motivo. Un rechazo la cierra.
 */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return identityGuard(async () => {
    const { requestId } = await context.params;
    const ctx = await requireApprovalAccess(requestId);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(approvalDecisionBody, request);
    return json(toApprovalRequestDto(await getApprovals().decide(requestId, ctx.user.id, body)));
  });
}
