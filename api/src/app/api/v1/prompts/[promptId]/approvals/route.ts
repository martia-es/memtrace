import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import type { PromptApprovalsResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toApprovalRequestDto, toApprovalRuleDto } from "@/adapters/inbound/http/prompt-mappers";
import { openApprovalBody } from "@/adapters/inbound/http/prompt-schemas";
import { getApprovals, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Las solicitudes de aprobación del prompt (ADR-076), las más recientes primero, y lo que exige hoy cada acción. Requiere `prompt:read`. */
export async function GET(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const approvals = getApprovals();
    const [requests, rules, directory] = await Promise.all([approvals.list(ctx.prompt), approvals.effectiveRules(ctx.prompt), approvals.directory(ctx.prompt)]);
    return json({ requests: requests.map(toApprovalRequestDto), rules: rules.map(toApprovalRuleDto), approvers: directory } satisfies PromptApprovalsResponse);
  });
}

/**
 * Abre una solicitud: publicar un borrador (`prompt:write`) o apuntar un entorno a una versión (`prompt:promote`).
 * 409 si la acción no exige aprobación, si el gate de evaluación no la dejaría hacer o si nadie podría aprobarla.
 */
export async function POST(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const body = await parseJsonOrThrow(openApprovalBody, request);
    const ctx = await requirePromptPermission(promptId, body.action === "publish" ? "prompt:write" : "prompt:promote");
    if (ctx instanceof Response) return ctx;
    const canBypass = await getIdentity().authorizationService.canInOrganization(ctx.user.id, ctx.prompt.organizationId, "governance:manage");
    return json(toApprovalRequestDto(await getApprovals().open(ctx.prompt, ctx.user.id, body, canBypass)), 201);
  });
}
