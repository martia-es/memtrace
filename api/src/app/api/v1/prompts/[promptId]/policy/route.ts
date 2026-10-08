import { requirePromptPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { toPromptPolicyDto } from "@/adapters/inbound/http/prompt-mappers";
import { policyBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPromptGate } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Política de promoción del prompt (ADR-070), o `null` si no tiene. Requiere `prompt:read`. */
export async function GET(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const policy = await getPromptGate().getPolicy(promptId);
    return json(policy ? toPromptPolicyDto(policy) : null);
  });
}

/**
 * Crea o cambia la política: el dataset contra el que se evalúa (de uno de los agentes del prompt) y cuántos runs seguidos
 * deben pasar. Requiere `prompt:promote`: quien decide qué versiones llegan a producción define cómo se comprueba.
 */
export async function PUT(request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:promote");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(policyBody, request);
    return json(toPromptPolicyDto(await getPromptGate().setPolicy(ctx.prompt, ctx.user.id, body)));
  });
}

/** Quita la política: desde ese momento cualquier versión puede promoverse. Requiere `prompt:promote`. */
export async function DELETE(_request: Request, context: { params: Promise<{ promptId: string }> }) {
  return identityGuard(async () => {
    const { promptId } = await context.params;
    const ctx = await requirePromptPermission(promptId, "prompt:promote");
    if (ctx instanceof Response) return ctx;
    await getPromptGate().deletePolicy(ctx.prompt);
    return json({ deleted: true });
  });
}
