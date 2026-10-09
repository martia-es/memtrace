import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { PromptNotFoundError } from "@/domain/errors";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Publica un borrador (ADR-072): pasa a ser una versión normal, que ya puede recibir tags y pasar por el gate de promoción.
 * Es una decisión de una persona: nada publica un borrador solo. 409 si no es un borrador. Requiere `prompt:write`.
 */
export async function POST(_request: Request, context: { params: Promise<{ promptId: string; ref: string }> }) {
  return identityGuard(async () => {
    const { promptId, ref } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    if (!/^\d+$/.test(ref)) throw new PromptNotFoundError(`Version "${ref}"`);
    return json(toPromptVersionDto(await getPrompts().publishDraft(promptId, Number(ref))));
  });
}
