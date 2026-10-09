import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Un fragmento cambió: reconstruye como BORRADORES los prompts que lo usan y se han quedado atrás (ADR-073). Solo toca los que
 * quien lo pide puede escribir; el resto se devuelve en `skipped`. Nada se publica ni se promueve. Requiere `prompt:write` sobre el fragmento.
 */
export async function POST(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const created: Array<{ promptId: string; name: string; version: number }> = [];
    const skipped: Array<{ promptId: string; name: string; reason: string }> = [];
    for (const dependent of await getPrompts().outdatedDependents(promptId)) {
      const allowed = await requirePromptPermission(dependent.promptId, "prompt:write");
      if (allowed instanceof Response) {
        skipped.push({ promptId: dependent.promptId, name: dependent.name, reason: "You cannot write this prompt" });
        continue;
      }
      try {
        const draft = await getPrompts().rebuild(dependent.promptId, ctx.user.id);
        created.push({ promptId: dependent.promptId, name: dependent.name, version: draft.version });
      } catch (error) {
        skipped.push({ promptId: dependent.promptId, name: dependent.name, reason: error instanceof Error ? error.message : "Could not rebuild" });
      }
    }
    return json({ created, skipped }, 201);
  });
}
