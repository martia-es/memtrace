import { ASSISTANT_READ, ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toAssistantCardDto } from "@/adapters/inbound/http/assistant-mappers";
import { updateAssistantBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ experimentId: string }> };

/** Ficha del agente (ADR-053/054): `governance:read` o `assistant:manage`. Todo experimento tiene ficha. */
export async function GET(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    return json(toAssistantCardDto(await getAssistantRegistry().getCard(experimentId)));
  });
}

/** Edita descripción, owner, equipo o ciclo de vida. */
export async function PATCH(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(updateAssistantBody, request);
    return json(toAssistantCardDto(await getAssistantRegistry().update(experimentId, body)));
  });
}
