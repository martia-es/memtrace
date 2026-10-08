import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptTagEventDto } from "@/adapters/inbound/http/prompt-mappers";
import { moveTagBody } from "@/adapters/inbound/http/prompt-schemas";
import { getIdentity, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Apunta el tag a una versión (ADR-067). Los tags de entorno (dev/pre/pro…) exigen `prompt:promote`; los libres, `prompt:write`.
 * Con una política (ADR-070), mover un entorno protegido exige una evaluación exitosa de la versión: si no la hay responde
 * `409` con el veredicto del gate. `bypassReason` salta el gate y exige `governance:manage`; el motivo queda en el historial.
 * Devuelve el evento del historial. Con `version: null` el tag se quita.
 */
export async function PUT(request: Request, context: { params: Promise<{ promptId: string; tag: string }> }) {
  return identityGuard(async () => {
    const { promptId, tag } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(moveTagBody, request);
    const canBypass = await getIdentity().authorizationService.canInOrganization(ctx.user.id, ctx.prompt.organizationId, "governance:manage");
    const event = await getPrompts().moveTag(promptId, ctx.user.id, { tag, version: body.version, reason: body.reason, bypassReason: body.bypassReason }, ctx.canPromote, canBypass);
    return json(toPromptTagEventDto(event));
  });
}

/** Quita el tag (queda en el historial). Mismos permisos que moverlo; quitar un tag no pasa por el gate. */
export async function DELETE(request: Request, context: { params: Promise<{ promptId: string; tag: string }> }) {
  return identityGuard(async () => {
    const { promptId, tag } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const reason = new URL(request.url).searchParams.get("reason") ?? "";
    return json(toPromptTagEventDto(await getPrompts().moveTag(promptId, ctx.user.id, { tag, version: null, reason }, ctx.canPromote)));
  });
}
