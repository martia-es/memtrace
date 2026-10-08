import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { saveVersionBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Guarda una versión nueva (inmutable). 409 si el texto es idéntico al de la última. Requiere `prompt:write`. */
export async function POST(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(saveVersionBody, request);
    return json(toPromptVersionDto(await getPrompts().saveVersion(promptId, ctx.user.id, body)), 201);
  });
}
