import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptTagEventDto } from "@/adapters/inbound/http/prompt-mappers";
import { moveTagBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Apunta el tag a una versión (ADR-067). Los tags de entorno (dev/pre/pro…) exigen `prompt:promote`; los libres, `prompt:write`.
 * Devuelve el evento del historial. Con `version: null` el tag se quita.
 */
export async function PUT(request: Request, context: { params: Promise<{ promptId: string; tag: string }> }) {
  return identityGuard(async () => {
    const { promptId, tag } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(moveTagBody, request);
    return json(toPromptTagEventDto(await getPrompts().moveTag(promptId, ctx.user.id, { tag, version: body.version, reason: body.reason }, ctx.canPromote)));
  });
}

/** Quita el tag (queda registrado en el historial). Mismos permisos que moverlo. */
export async function DELETE(request: Request, context: { params: Promise<{ promptId: string; tag: string }> }) {
  return identityGuard(async () => {
    const { promptId, tag } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const reason = new URL(request.url).searchParams.get("reason") ?? "";
    return json(toPromptTagEventDto(await getPrompts().moveTag(promptId, ctx.user.id, { tag, version: null, reason }, ctx.canPromote)));
  });
}
