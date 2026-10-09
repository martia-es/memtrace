import { requireApprovalAccess } from "@/adapters/inbound/http/approval-access";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Retira la solicitud. Solo quien la pidió (403 en otro caso). */
export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  return identityGuard(async () => {
    const { requestId } = await context.params;
    const ctx = await requireApprovalAccess(requestId);
    if (ctx instanceof Response) return ctx;
    return json(toApprovalRequestDto(await getApprovals().cancel(requestId, ctx.user.id)));
  });
}
