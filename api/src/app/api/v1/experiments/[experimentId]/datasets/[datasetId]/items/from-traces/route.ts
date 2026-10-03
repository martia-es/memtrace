import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toPromoteTracesResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { promoteTracesBody } from "@/adapters/inbound/http/schemas";
import { getDatasetPromotion, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Promueve trazas (con su etiqueta humana opcional) a items del dataset: UNA versión MAJOR por llamada, sea cual sea
 * el número de trazas (ADR-038). Solo sesión de usuario: es una acción humana desde el dashboard, no del SDK.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;

    const dataset = await getIdentity().identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const { items } = await parseJsonOrThrow(promoteTracesBody, request);
    const result = await getDatasetPromotion().promoteTraces({ userId: ctx.user.id, serviceName: ctx.serviceName }, datasetId, items);
    return json(toPromoteTracesResponse(result), result.added.length > 0 ? 201 : 200);
  });
}
