import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toTraceAnnotationsResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { saveAnnotationBody } from "@/adapters/inbound/http/schemas";
import { getAnnotation } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; traceId: string }> };

/** Anotaciones humanas de la traza de todos los anotadores, más sus scores automáticos (ADR-037). Cualquier miembro. */
export async function GET(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    return json(toTraceAnnotationsResponse(await getAnnotation().listForTrace(ctx.serviceName, traceId)));
  });
}

/** Crea o edita la anotación del usuario autenticado para (traza, span, config). El anotador nunca viene en el cuerpo. */
export async function POST(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;

    const body = await parseJsonOrThrow(saveAnnotationBody, request);
    const actor = { userId: ctx.user.id, experimentId, serviceName: ctx.serviceName };
    await getAnnotation().saveAnnotation(actor, traceId, body);
    // devuelve la vista completa para que el cliente se refresque con una sola respuesta
    return json(toTraceAnnotationsResponse(await getAnnotation().listForTrace(ctx.serviceName, traceId)), 201);
  });
}
