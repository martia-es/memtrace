import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toDatasetItemsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { commitDatasetChangesBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Publica una sesión de edición del dashboard (altas + ediciones + bajas) como UNA sola versión
 * nueva (ADR-041): MAJOR si hay altas o bajas, MINOR si solo ediciones, con la nota generada sola.
 * Devuelve los items resultantes y la versión creada. Solo sesión (dashboard).
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
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

    const body = await parseJsonOrThrow(commitDatasetChangesBody, request);
    const version = await identityRepository.commitDatasetChanges(datasetId, user.id, {
      add: body.add.map((i) => ({ input: i.input, expectedOutput: i.expectedOutput ?? null, metadata: (i.metadata ?? null) as Record<string, unknown> | null })),
      update: body.update.map(({ id, ...patch }) => ({ id, patch: patch as { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null } })),
      remove: body.remove,
    });
    return json(toDatasetItemsListResponse(await identityRepository.listDatasetItems(version.id), version), 201);
  });
}
