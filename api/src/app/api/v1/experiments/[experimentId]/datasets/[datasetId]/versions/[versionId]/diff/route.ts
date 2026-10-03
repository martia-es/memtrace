import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toDatasetVersionDiffResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";
import { diffDatasetVersions } from "@/domain/dataset-diff";

export const dynamic = "force-dynamic";

/**
 * Diff de una versión contra otra del mismo dataset (dashboard, sesión únicamente, ADR-033).
 * `?against=<versionId>` elige la versión de referencia (cualquiera, no solo la adyacente); sin él
 * se usa la inmediatamente anterior, y si no existe (versión inicial) todo cuenta como añadido.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; versionId: string }> }) {
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

    const versions = await identityRepository.listDatasetVersions(datasetId); // más reciente primero
    const targetIndex = versions.findIndex((v) => v.id === versionId);
    const target = versions[targetIndex];
    if (!target) return problem(404, "Not Found", "Version not found");

    const againstId = new URL(request.url).searchParams.get("against");
    const base = againstId ? versions.find((v) => v.id === againstId) : versions[targetIndex + 1];
    if (againstId && !base) return problem(404, "Not Found", "Version to compare against not found");

    const [targetItems, baseItems] = await Promise.all([
      identityRepository.listDatasetVersionItemsWithDeleted(target.id),
      base ? identityRepository.listDatasetVersionItemsWithDeleted(base.id) : Promise.resolve([]),
    ]);
    return json(toDatasetVersionDiffResponse(base ?? null, target, diffDatasetVersions(baseItems, targetItems)));
  });
}
