import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptDetailDto } from "@/adapters/inbound/http/prompt-mappers";
import { updatePromptBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Un prompt con todas sus versiones, tags y el historial de movimientos de tags (ADR-067). Requiere `prompt:read`. */
export async function GET(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    return json(toPromptDetailDto(await getPrompts().detail(promptId)));
  });
}

/** Cambia la descripción, archiva/restaura el prompt o sustituye sus agentes. Eliminar es archivar: el historial no se pierde. Requiere `prompt:write`. */
export async function PATCH(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(updatePromptBody, request);
    return json(toPromptDetailDto(await getPrompts().update(promptId, body)));
  });
}
