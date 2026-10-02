import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toDatasetVersionsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Historial de versiones de un dataset, más reciente primero (dashboard, sesión únicamente).
 * Puramente informativo (ADR-032): no hay POST — una versión nunca se crea a mano, siempre es
 * el resultado automático de añadir, editar o borrar un item (ver `datasets/[datasetId]/items`).
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const versions = await identityRepository.listDatasetVersions(datasetId);
    const withCounts = await Promise.all(versions.map(async (version) => ({ version, itemCount: (await identityRepository.listDatasetItems(version.id)).length })));
    return json(toDatasetVersionsListResponse(withCounts));
  });
}
