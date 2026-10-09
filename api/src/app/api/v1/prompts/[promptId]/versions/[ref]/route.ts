import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { PromptNotFoundError } from "@/domain/errors";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Descarta un borrador (ADR-072). Una versión publicada no se borra nunca (409). Requiere `prompt:write`. */
export async function DELETE(_request: Request, context: { params: Promise<{ promptId: string; ref: string }> }) {
  return identityGuard(async () => {
    const { promptId, ref } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    if (!/^\d+$/.test(ref)) throw new PromptNotFoundError(`Version "${ref}"`);
    await getPrompts().discardDraft(promptId, Number(ref));
    return json({ deleted: true });
  });
}

/** Recupera una versión por número (`/versions/3`) o por tag (`/versions/pro`). Requiere `prompt:read`. */
export async function GET(_request: Request, context: { params: Promise<{ promptId: string; ref: string }> }) {
  return identityGuard(async () => {
    const { promptId, ref } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    return json(toPromptVersionDto(await getPrompts().resolve(promptId, ref)));
  });
}
