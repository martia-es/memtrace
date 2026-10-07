import { requireExperimentAccess, requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toTraceFeedbackResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { parseOrThrow, queryToObject, retractFeedbackQuery, submitFeedbackBody } from "@/adapters/inbound/http/schemas";
import { getUserFeedback } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; traceId: string }> };

/** Votos de usuario final de la traza y si coinciden con la revisión humana (ADR-062). Cualquier miembro. */
export async function GET(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    return json(toTraceFeedbackResponse(await getUserFeedback().listForTrace(experimentId, ctx.serviceName, traceId)));
  });
}

/**
 * Registra o cambia el 👍/👎 de un usuario final sobre la respuesta de la traza. Lo llama el agente con su API key (el
 * navegador final nunca la ve) o una persona del experimento probando el chat desde el dashboard (`annotation:write`).
 * Con sesión, el votante es esa persona (`memtrace-user:<id>`): cambiar su voto lo sustituye, no lo duplica.
 */
export async function POST(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request, "annotation:write");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(submitFeedbackBody, request);
    const bySession = !request.headers.get("authorization");
    const endUserId = bySession ? `memtrace-user:${access.createdByUserId}` : body.endUserId;
    await getUserFeedback().submit(access.serviceName, traceId, { ...body, endUserId });
    return json(toTraceFeedbackResponse(await getUserFeedback().listForTrace(experimentId, access.serviceName, traceId)), 201);
  });
}

/** Retira el voto del usuario final (`endUserId`, o el anónimo si no se indica). Idempotente. */
export async function DELETE(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request, "annotation:write");
    if (access instanceof Response) return access;
    const query = parseOrThrow(retractFeedbackQuery, queryToObject(new URL(request.url).searchParams));
    const bySession = !request.headers.get("authorization");
    await getUserFeedback().retract(access.serviceName, traceId, bySession ? { ...query, endUserId: `memtrace-user:${access.createdByUserId}` } : query);
    return new Response(null, { status: 204 });
  });
}
