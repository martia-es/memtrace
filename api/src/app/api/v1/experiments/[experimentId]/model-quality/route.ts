import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getModelQuality } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Puntuación de calidad (Arena) de los modelos del catálogo de precios para este agente (ADR-025): la puntuación de cada uno, o el
 * candidato que espera confirmación, y cuáles aparecen en sus trazas. Las decisiones son de la organización. Requiere `experiment:read`.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "experiment:read");
    if (access instanceof Response) return access;
    return json(await getModelQuality().overview({ organizationId: access.organizationId, scope: access.scope }));
  });
}
