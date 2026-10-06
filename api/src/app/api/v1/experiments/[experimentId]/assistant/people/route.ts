import { ASSISTANT_GOVERN, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import type { PeopleResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Busca personas de la organización por nombre o email, para elegir a quién dar acceso. Solo gobernanza: `governance:manage`. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_GOVERN);
    if (ctx instanceof Response) return ctx;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const items = await getAssistantRegistry().searchPeople(experimentId, (url.searchParams.get("q") ?? "").slice(0, 100), Number.isFinite(limit) ? limit : 20);
    return json({ items } satisfies PeopleResponse);
  });
}
