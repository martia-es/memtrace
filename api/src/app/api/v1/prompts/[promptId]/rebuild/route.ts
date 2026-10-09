import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Vuelve a resolver los fragmentos de la última versión publicada contra sus versiones de hoy y guarda el resultado como
 * BORRADOR para revisar (ADR-073). 409 si no incluye fragmentos o si ya resuelve al mismo texto. Requiere `prompt:write`.
 */
export async function POST(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    return json(toPromptVersionDto(await getPrompts().rebuild(promptId, ctx.user.id)), 201);
  });
}
