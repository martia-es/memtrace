import { requireApprovalAccess } from "@/adapters/inbound/http/approval-access";
import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Reintenta una solicitud aprobada que no pudo ejecutarse (por ejemplo, la evaluación de la versión aún no pasaba el gate).
 * Se vuelve a evaluar con la regla de hoy. Requiere `prompt:write` (publicar) o `prompt:promote` (promover).
 */
export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  return identityGuard(async () => {
    const { requestId } = await context.params;
    const ctx = await requireApprovalAccess(requestId);
    if (ctx instanceof Response) return ctx;
    const allowed = await requirePromptPermission(ctx.prompt.id, ctx.request.action === "publish" ? "prompt:write" : "prompt:promote");
    if (allowed instanceof Response) return allowed;
    return json(toApprovalRequestDto(await getApprovals().execute(requestId, ctx.user.id)));
  });
}
