import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { problem } from "@/adapters/inbound/http/problem";
import { retractAnnotationQuery } from "@/adapters/inbound/http/schemas";
import { getAnnotation } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Retira la anotación propia (`?spanId=` para una de span). Un admin puede retirar la de otra persona con
 * `?annotatorId=`; queda como lápida con su rastro, no como sobrescritura silenciosa (ADR-037). 204, idempotente.
 */
export async function DELETE(request: Request, context: { params: Promise<{ experimentId: string; traceId: string; configId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, traceId, configId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;

    const query = retractAnnotationQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return problem(400, "Bad Request", "Invalid query parameters");

    await getAnnotation().retractAnnotation({ userId: ctx.user.id, experimentId, serviceName: ctx.serviceName }, traceId, {
      configId,
      spanId: query.data.spanId,
      annotatorId: query.data.annotatorId,
      actorIsAdmin: ctx.access === "admin" || ctx.access === "org_admin",
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
