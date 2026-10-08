import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptGateDto } from "@/adapters/inbound/http/prompt-mappers";
import { gateQuery } from "@/adapters/inbound/http/prompt-schemas";
import { parseOrThrow, queryToObject } from "@/adapters/inbound/http/schemas";
import { PromptNotFoundError } from "@/domain/errors";
import { getPromptGate, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * ¿Puede moverse `?tag=` a `?version=`? (ADR-070). Solo lee: dice si hay una evaluación exitosa de esa versión contra el
 * dataset de la política y, si no, por qué. Es lo que muestra la pantalla antes de pulsar «Move». Requiere `prompt:read`.
 */
export async function GET(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const { tag, version } = parseOrThrow(gateQuery, queryToObject(new URL(request.url).searchParams));
    await getPrompts().resolve(promptId, String(version)); // 404 si la versión no existe
    if (!(await getPrompts().detail(promptId)).environmentKeys.includes(tag)) throw new PromptNotFoundError(`Environment "${tag}"`);
    return json(toPromptGateDto(await getPromptGate().check(ctx.prompt, tag, version)));
  });
}
