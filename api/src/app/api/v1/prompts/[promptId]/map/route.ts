import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import type { PromptMapDto } from "@/adapters/inbound/http/contract";
import { json } from "@/adapters/inbound/http/problem";
import { gateQuery } from "@/adapters/inbound/http/prompt-schemas";
import { parseOrThrow, queryToObject } from "@/adapters/inbound/http/schemas";
import { PromptNotFoundError } from "@/domain/errors";
import { getPromptMap, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * De qué depende y quién depende de este prompt (ADR-074): agentes que lo leen y lo que sirven por entorno, dataset de su
 * política, fragmentos que incluye y prompts que lo incluyen. Con `?tag=&version=` añade el impacto de mover ese tag: a qué
 * agentes llegaría el cambio. Solo lee. Requiere `prompt:read`.
 */
export async function GET(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    let move: { tag: string; version: number } | undefined;
    if (params.has("tag") || params.has("version")) {
      move = parseOrThrow(gateQuery, queryToObject(params));
      await getPrompts().resolve(promptId, String(move.version)); // 404 si la versión no existe
      if (!(await getPrompts().detail(promptId)).environmentKeys.includes(move.tag)) throw new PromptNotFoundError(`Environment "${move.tag}"`);
    }
    const map = await getPromptMap().map(promptId, move);
    const dto: PromptMapDto = { agents: map.agents, dataset: map.dataset, includes: map.includes, usedBy: map.usedBy, impact: map.impact };
    return json(dto);
  });
}
