import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toDatasetItemsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Items de una versión concreta, INCLUIDOS los tombstones de items borrados en ella (dashboard,
 * sesión únicamente). Puramente de lectura, para inspeccionar el historial (ADR-032 follow-up) —
 * p. ej. ver quién borró un item y cuándo. No confundir con `datasets/[datasetId]/items`, que
 * siempre resuelve la última versión y solo items activos.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; versionId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId, versionId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    return json(toDatasetItemsListResponse(await identityRepository.listDatasetVersionItemsWithDeleted(versionId)));
  });
}
