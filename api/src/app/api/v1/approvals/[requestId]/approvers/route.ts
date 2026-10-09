import { requireApprovalAccess } from "@/adapters/inbound/http/approval-access";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto } from "@/adapters/inbound/http/prompt-mappers";
import { addApproverBody } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Añade a una persona como aprobadora obligatoria de esta solicitud. Quien la pidió o quien puede aprobarla. */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return identityGuard(async () => {
    const { requestId } = await context.params;
    const ctx = await requireApprovalAccess(requestId);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(addApproverBody, request);
    return json(toApprovalRequestDto(await getApprovals().addApprover(requestId, ctx.user.id, body.approverId)));
  });
}
