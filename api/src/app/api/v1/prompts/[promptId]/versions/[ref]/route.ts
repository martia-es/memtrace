import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Recupera una versión por número (`/versions/3`) o por tag (`/versions/pro`). Requiere `prompt:read`. */
export async function GET(_request: Request, context: { params: Promise<{ promptId: string; ref: string }> }) {
  return identityGuard(async () => {
    const { promptId, ref } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    return json(toPromptVersionDto(await getPrompts().resolve(promptId, ref)));
  });
}
